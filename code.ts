// Initialize Firebase
const firebaseConfig = {
  apiKey: "AIzaSyDqZ94q1Y5p0o3RBB9WVwTcEpffpE9TrOY",
  authDomain: "figma-time-tracking.firebaseapp.com",
  databaseURL: "https://figma-time-tracking-default-rtdb.firebaseio.com",
  projectId: "figma-time-tracking",
  storageBucket: "figma-time-tracking.appspot.com",
  messagingSenderId: "834194482688",
  appId: "1:834194482688:web:a3a39c6dab677105e1b101"
};

// Plugin constants
const INACTIVE_THRESHOLD = 5 * 60 * 1000; // 5 minutes in milliseconds
const FILE_CHECK_INTERVAL = 2000; // Check for file changes every 2 seconds
const ACTIVITY_CHECK_INTERVAL = 30 * 1000; // Check for activity every 30 seconds

// Global state
let isTracking = false;
let trackingStartTime: number | null = null;
let lastActivityTime = Date.now();
let currentFile: { id: string, name: string } | null = null;
let currentPage: { id: string, name: string } | null = null;
let previousFileId: string | null = null;
let files: Array<FileData> = [];
let activityInterval: number;
let fileCheckInterval: number;

// Define types
interface PageData {
  pageId: string;
  pageName: string;
  isActive: boolean;
  trackedTime: number;
}

interface FileData {
  fileId: string;
  fileName: string;
  isActive: boolean;
  lastActive: number;
  totalTrackedTime: number;
  pages: Array<PageData>;
}

interface TimeEntry {
  fileId: string;
  fileName: string;
  pageId: string;
  pageName: string;
  startTime: number;
  endTime: number;
  duration: number;
}

// Generate a unique user ID
function generateUserId(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// Get the user ID, generating a new one if needed
async function getUserId(): Promise<string> {
  const storedId = await figma.clientStorage.getAsync('userId');
  if (storedId) return storedId as string;
  
  // If no ID exists, generate a new one and save it
  const newId = generateUserId();
  figma.clientStorage.setAsync('userId', newId);
  return newId;
}

// Check if the current file has changed
function checkFileChange() {
  const currentFileId = figma.currentPage.parent.id;
  
  // If we have a different file than before, handle the change
  if (currentFileId !== currentFile?.id) {
    console.log(`File changed from ${currentFile?.id} to ${currentFileId}`);
    handleFileChange(currentFileId);
  }
}

// Handle file change
function handleFileChange(newFileId: string) {
  if (!newFileId) return;
  
  // Save previous file ID
  previousFileId = currentFile?.id || null;
  
  // Stop tracking the previous file if we were tracking
  if (isTracking && previousFileId) {
    stopTracking(false);
  }
  
  // Update current file and page
  updateFileAndPage();
  
  // If we were tracking before, start tracking the new file
  if (previousFileId && isTracking) {
    startTracking();
  }
  
  // Notify the UI about the file change
  figma.ui.postMessage({
    type: 'file-changed',
    fileId: currentFile?.id || null,
    fileName: currentFile?.name || null
  });
  
  // Update file list
  savePluginData();
}

// Update the current file and page
function updateFileAndPage() {
  try {
    // Get current file information
    const fileId = figma.currentPage.parent.id;
    let fileName = "Untitled";
    
    // Try to safely access the name property
    if (figma.currentPage.parent && 'name' in figma.currentPage.parent) {
      fileName = (figma.currentPage.parent as any).name;
    }
    
    // Get current page information
    const pageId = figma.currentPage.id;
    const pageName = figma.currentPage.name;
    
    currentFile = { id: fileId, name: fileName };
    currentPage = { id: pageId, name: pageName };
    
    console.log(`Current file: ${fileName}, current page: ${pageName}`);
  } catch (error) {
    console.error("Error updating file and page info:", error);
  }
}

// Start tracking time
function startTracking() {
  if (!currentFile || !currentPage) {
    updateFileAndPage();
  }
  
  if (!currentFile || !currentPage) {
    console.error('Cannot start tracking: no current file or page');
    return;
  }
  
  console.log(`Starting tracking for ${currentFile.name} - ${currentPage.name}`);
  
  isTracking = true;
  trackingStartTime = Date.now();
  lastActivityTime = Date.now();
  
  // Update file data for current file and page
  updateFileData();
  
  // Send tracking status to UI
  updateTrackingStatus();
}

// Stop tracking time
function stopTracking(updateUI = true) {
  if (!isTracking || !trackingStartTime || !currentFile || !currentPage) {
    isTracking = false;
    trackingStartTime = null;
    if (updateUI) {
      updateTrackingStatus();
    }
    return;
  }
  
  console.log(`Stopping tracking for ${currentFile.name}`);
  
  const endTime = Date.now();
  const duration = Math.floor((endTime - trackingStartTime) / 1000);
  
  if (duration > 0) {
    // Create a time entry
    const timeEntry: TimeEntry = {
      fileId: currentFile.id,
      fileName: currentFile.name,
      pageId: currentPage.id,
      pageName: currentPage.name,
      startTime: trackingStartTime,
      endTime: endTime,
      duration: duration
    };
    
    // Update file data
    updateFileData(duration);
    
    // Send time entry to UI for saving
    figma.ui.postMessage({
      type: 'save-time-entry',
      timeEntry
    });
  }
  
  isTracking = false;
  trackingStartTime = null;
  
  if (updateUI) {
    updateTrackingStatus();
  }
}

// Check if user is active
function checkActivity() {
  const now = Date.now();
  const inactiveTime = now - lastActivityTime;
  
  if (inactiveTime > INACTIVE_THRESHOLD && isTracking) {
    console.log('User inactive, stopping tracking');
    stopTracking();
  }
}

// Update tracking status in UI
function updateTrackingStatus() {
  if (!figma.ui) return;
  
  figma.ui.postMessage({
    type: 'tracking-status',
    isTracking,
    fileId: currentFile?.id,
    fileName: currentFile?.name,
    pageId: currentPage?.id,
    pageName: currentPage?.name,
    startTime: trackingStartTime
  });
}

// Update file data
function updateFileData(duration = 0) {
  if (!currentFile || !currentPage) return;
  
  // Find or create file data
  let fileData = files.find(f => f.fileId === currentFile?.id);
  if (!fileData) {
    fileData = {
      fileId: currentFile.id,
      fileName: currentFile.name,
      isActive: true,
      lastActive: Date.now(),
      totalTrackedTime: 0,
      pages: []
    };
    files.push(fileData);
  } else {
    // Update existing file
    fileData.fileName = currentFile.name; // Ensure name is up to date
    fileData.isActive = true;
    fileData.lastActive = Date.now();
  }
  
  // Add duration to total
  if (duration > 0) {
    fileData.totalTrackedTime += duration;
  }
  
  // Clear active flag on all files except current
  files.forEach(f => {
    if (f.fileId !== currentFile?.id) {
      f.isActive = false;
    }
  });
  
  // Find or create page data
  let pageData = fileData.pages.find(p => p.pageId === currentPage?.id);
  if (!pageData) {
    pageData = {
      pageId: currentPage.id,
      pageName: currentPage.name,
      isActive: true,
      trackedTime: 0
    };
    fileData.pages.push(pageData);
  } else {
    // Update existing page
    pageData.pageName = currentPage.name; // Ensure name is up to date
    pageData.isActive = true;
  }
  
  // Add duration to page
  if (duration > 0) {
    pageData.trackedTime += duration;
  }
  
  // Clear active flag on all pages except current
  fileData.pages.forEach(p => {
    if (p.pageId !== currentPage?.id) {
      p.isActive = false;
    }
  });
  
  // Save the data
  savePluginData();
}

// Save plugin data
function savePluginData() {
  // Save to client storage
  figma.clientStorage.setAsync('files', files)
    .then(() => {
      console.log('Saved plugin data successfully');
    })
    .catch(error => {
      console.error('Error saving plugin data:', error);
    });
  
  // Update UI with files data
  figma.ui.postMessage({
    type: 'files-updated',
    files: files,
    activeFileId: currentFile?.id
  });
}

// Load plugin data
function loadPluginData() {
  figma.clientStorage.getAsync('files')
    .then((savedFiles) => {
      if (savedFiles) {
        files = savedFiles as Array<FileData>;
        console.log(`Loaded ${files.length} files from storage`);
        
        // Mark all files and pages as inactive initially
        files.forEach(file => {
          file.isActive = false;
          file.pages.forEach(page => {
            page.isActive = false;
          });
        });
        
        // Update current file and page, which will set the active flags
        updateFileAndPage();
        updateFileData();
      }
    })
    .catch(error => {
      console.error('Error loading plugin data:', error);
    });
}

// Handle user activity
function handleActivity() {
  lastActivityTime = Date.now();
  
  // If we're not tracking, check if we should start
  if (!isTracking) {
    // Make sure we have current file and page
    updateFileAndPage();
    startTracking();
  }
}

// Set up the plugin
async function initializePlugin() {
  // Create the UI
  figma.showUI(__html__, { width: 320, height: 520 });
  
  // Load saved data
  loadPluginData();
  
  // Get the user ID
  const userId = await getUserId();
  
  // Send Firebase config to UI
  figma.ui.postMessage({
    type: 'firebase-config',
    config: firebaseConfig,
    userId
  });
  
  // Set up event listeners for user activity
  figma.on('selectionchange', handleActivity);
  figma.on('currentpagechange', () => {
    handleActivity();
    updateFileAndPage();
    updateFileData();
    updateTrackingStatus();
  });
  
  // Start activity check interval
  activityInterval = setInterval(checkActivity, ACTIVITY_CHECK_INTERVAL);
  
  // Start file check interval to detect file changes
  fileCheckInterval = setInterval(checkFileChange, FILE_CHECK_INTERVAL);
  
  // Update file and page initially
  updateFileAndPage();
  updateFileData();
}

// Handle messages from the UI
figma.ui.onmessage = (msg: any) => {
  switch (msg.type) {
    case 'check-tracking-status':
      updateTrackingStatus();
      break;
      
    case 'resume-tracking':
      handleActivity();
      break;
      
    case 'stop-tracking':
      stopTracking();
      break;
  }
};

// Initialize the plugin
initializePlugin();

// Clean up when the plugin is closed
figma.on('close', () => {
  // Stop tracking when plugin closes
  if (isTracking) {
    stopTracking();
  }
  
  // Clear intervals
  clearInterval(activityInterval);
  clearInterval(fileCheckInterval);
});