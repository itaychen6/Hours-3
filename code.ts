// This file holds the main code for plugins. Code in this file has access to
// the *figma document* via the figma global object.
// You can access browser APIs in the <script> tag inside "ui.html" which has a
// full browser environment (See https://www.figma.com/plugin-docs/how-plugins-run).

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
const INACTIVE_THRESHOLD = 5 * 1000; // 5 seconds in milliseconds (was 5 minutes)
const FILE_CHECK_INTERVAL = 2000; // Check for file changes every 2 seconds
const ACTIVITY_CHECK_INTERVAL = 5 * 1000; // Check for activity every 5 seconds (was 30 seconds)

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
let userId: string | null = null;
let activeFileId: string | null = null;
let currentFileName: string | null = null;
let currentPageName: string | null = null;
let activePageId: string | null = null;

// Define types
interface PageData {
  id: string;
  name: string;
  totalTime: number;
}

interface FileData {
  id: string;
  name: string;
  pages: { [key: string]: PageData };
  totalTime: number;
}

interface TimeEntry {
  id: string;
  userId: string;
  fileId: string;
  fileName: string;
  pageId: string;
  pageName: string;
  startTime: number;
  endTime: number;
  duration: number;
  date: string;
}

// Generate a unique user ID for this user (or use the existing one)
async function generateUserId(): Promise<string> {
  let userId = await figma.clientStorage.getAsync('userId') as string;
  
  if (!userId) {
    userId = `user_${Math.random().toString(36).substring(2, 15)}`;
    await figma.clientStorage.setAsync('userId', userId);
  }
  
  return userId;
}

// Get the user ID, generating a new one if needed
async function getUserId(): Promise<string> {
  const storedId = await figma.clientStorage.getAsync('userId');
  if (storedId) return storedId as string;
  
  // If no ID exists, generate a new one and save it
  const newId = await generateUserId();
  return newId;
}

// Check if the current file has changed
function checkFileChange() {
  const currentFileNode = figma.currentPage.parent;
  if (!currentFileNode) return;

  const currentFileId = currentFileNode.id;
  
  // If we have a different file than before, handle the change
  if (currentFileId !== activeFileId) {
    console.log(`File changed from ${activeFileId || 'none'} to ${currentFileId}`);
    handleFileChange();
  }
}

// Handle file change
function handleFileChange() {
  const currentFileNode = figma.currentPage.parent;
  if (!currentFileNode) return;
  
  const newFileId = currentFileNode.id;
  let fileName = "Untitled";
  
  // Try to safely access the name property
  if ('name' in currentFileNode) {
    fileName = (currentFileNode as any).name;
  }
  
  // Store previous file ID before changing
  const prevFileId = activeFileId;
  
  // If file changed
  if (activeFileId !== newFileId) {
    console.log(`File changed from ${activeFileId || 'none'} to ${newFileId}`);
    
    // Create a time entry for the previous file if we were tracking it
    if (isTracking && prevFileId) {
      console.log(`Creating time entry for previous file ${prevFileId}`);
      
      const currentTime = Date.now();
      const duration = currentTime - trackingStartTime;
      
      // Only create an entry if we tracked for at least 3 seconds
      if (duration >= 3000) {
        createTimeEntry(prevFileId, duration);
      }
      
      // Don't fully stop tracking - we'll continue with the new file
      // Just reset the timer for the next file
      trackingStartTime = currentTime;
    }
    
    // Update the active file ID
    activeFileId = newFileId;
    currentFileName = fileName;
    
    // Update the active page
    activePageId = figma.currentPage.id;
    currentPageName = figma.currentPage.name;
    
    // Find or create file data
    let fileData = files.find(f => f.id === newFileId);
    if (!fileData) {
      // Create new file data
      fileData = {
        id: newFileId,
        name: fileName,
        pages: {},
        totalTime: 0
      };
      files.push(fileData);
    }
    
    // Notify UI about file change
    figma.ui.postMessage({
      type: 'file-changed',
      fileId: newFileId,
      fileName: fileName,
      isTracking: isTracking,
      startTime: isTracking ? trackingStartTime : 0
    });
    
    // The main difference from before: if we were tracking, continue tracking the new file
    if (isTracking) {
      // We already reset trackingStartTime above if we were tracking
      lastActivityTime = Date.now();
      
      // Send tracking status to UI
      figma.ui.postMessage({
        type: 'tracking-status',
        isTracking: true,
        startTime: trackingStartTime,
        fileName: fileName,
        pageName: currentPageName
      });
    }
    
    // Update the file list in UI
    updateFilesList();
    
    // Save data
    savePluginData();
  }
}

// Helper function to create a time entry for a specific file
function createTimeEntry(fileId: string, duration: number) {
  // Find the file and page names
  const fileData = files.find(f => f.id === fileId);
  if (!fileData) return;
  
  // Calculate the time range
  const endTime = Date.now();
  const startTime = endTime - duration;
  
  // Create the time entry
  const timeEntry: TimeEntry = {
    id: `entry_${Date.now()}`,
    userId: userId,
    fileId: fileId,
    fileName: fileData.name,
    pageId: activePageId || '',
    pageName: currentPageName || '',
    startTime: startTime,
    endTime: endTime,
    duration: duration,
    date: new Date().toISOString().split('T')[0]
  };
  
  // Update file data
  fileData.totalTime += duration;
  
  // Update page data if it exists
  if (activePageId && fileData.pages[activePageId]) {
    fileData.pages[activePageId].totalTime += duration;
  }
  
  // Send the time entry to the UI for saving to Firebase
  figma.ui.postMessage({
    type: 'save-time-entry',
    timeEntry: timeEntry
  });
  
  console.log(`Created time entry: ${formatTime(duration)} on ${fileData.name}`);
}

// Update the current file and page
function updateFileAndPage() {
  try {
    // Get current file information
    const fileNode = figma.currentPage.parent;
    if (!fileNode) return;
    
    const fileId = fileNode.id;
    let fileName = "Untitled";
    
    // Try to safely access the name property
    if ('name' in fileNode) {
      fileName = (fileNode as any).name;
    }
    
    // Get current page information
    const pageId = figma.currentPage.id;
    const pageName = figma.currentPage.name;
    
    // Update current file and page info
    currentFile = { id: fileId, name: fileName };
    currentPage = { id: pageId, name: pageName };
    
    // Also update the tracking variables
    activeFileId = fileId;
    currentFileName = fileName;
    activePageId = pageId;
    currentPageName = pageName;
    
    console.log(`Current file: ${fileName}, current page: ${pageName}`);
  } catch (error) {
    console.error("Error updating file and page info:", error);
  }
}

// Start tracking time
function startTracking() {
  // If already tracking, don't start again
  if (isTracking) return;
  
  // Start tracking
  isTracking = true;
  trackingStartTime = Date.now();
  lastActivityTime = trackingStartTime;
  
  // Send tracking status to UI
  figma.ui.postMessage({
    type: 'tracking-status',
    isTracking: true,
    startTime: trackingStartTime,
    fileName: currentFileName || '',
    pageName: currentPageName || ''
  });
  
  console.log(`Started tracking on ${currentFileName || 'unknown file'} - ${currentPageName || 'unknown page'}`);
}

// Stop tracking time
function stopTracking(createEntry = true) {
  if (!isTracking) return;
  
  const currentTime = Date.now();
  const duration = currentTime - trackingStartTime;
  
  // Only count if we've been tracking for at least 5 seconds
  if (createEntry && duration >= 5000) {
    createTimeEntry(activeFileId, duration);
  }
  
  // Reset tracking state
  isTracking = false;
  trackingStartTime = 0;
  
  // Update UI with tracking status
  figma.ui.postMessage({
    type: 'tracking-status',
    isTracking: false,
    fileName: currentFileName || '',
    pageName: currentPageName || ''
  });
  
  console.log(`Stopped tracking on ${currentFileName || 'unknown file'}`);
  
  // Save data
  savePluginData();
}

// Update the file list in the UI
function updateFilesList() {
  figma.ui.postMessage({
    type: 'files-updated',
    files: files,
    activeFileId: activeFileId || ''
  });
}

// Check if user is active
function checkActivity() {
  const now = Date.now();
  const inactiveTime = now - lastActivityTime;
  
  // More aggressive check - try to detect if we're in a different file/context
  try {
    // First, check if we can still access the document
    // This will throw an error if we've lost access to the document
    const currentNode = figma.currentPage;
    if (!currentNode) {
      console.log('Cannot access document, likely switched context');
      if (isTracking) stopTracking();
      return;
    }
    
    // Check if current file is still what we expect
    const currentFileNode = figma.currentPage.parent;
    if (currentFileNode && currentFileNode.id !== activeFileId) {
      console.log('File ID mismatch, handling file change');
      handleFileChange();
      return;
    }
  } catch (error) {
    // If any error occurs, assume we've lost context
    console.error('Error checking activity, likely lost context:', error);
    if (isTracking) stopTracking();
    return;
  }
  
  // Normal inactivity check
  if (inactiveTime > INACTIVE_THRESHOLD && isTracking) {
    console.log(`User inactive for ${inactiveTime}ms, stopping tracking`);
    stopTracking();
  }
}

// Update tracking status in UI
function updateTrackingStatus() {
  if (!figma.ui) return;
  
  console.log('Updating tracking status:', {
    isTracking,
    fileId: currentFile?.id,
    fileName: currentFile?.name,
    startTime: trackingStartTime
  });
  
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
  let fileData = files.find(f => f.id === currentFile?.id);
  if (!fileData) {
    fileData = {
      id: currentFile.id,
      name: currentFile.name,
      pages: {},
      totalTime: 0
    };
    files.push(fileData);
  } else {
    // Update existing file
    fileData.name = currentFile.name; // Ensure name is up to date
  }
  
  // Add duration to total
  if (duration > 0) {
    fileData.totalTime += duration;
  }
  
  // Find or create page data
  let pageData = fileData.pages[currentPage?.id];
  if (!pageData) {
    pageData = {
      id: currentPage.id,
      name: currentPage.name,
      totalTime: 0
    };
    fileData.pages[currentPage?.id] = pageData;
  } else {
    // Update existing page
    pageData.name = currentPage.name; // Ensure name is up to date
  }
  
  // Add duration to page
  if (duration > 0) {
    pageData.totalTime += duration;
  }
  
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
    activeFileId: activeFileId || ''
  });
  
  // Also save to Firebase if we have a user ID
  saveDataToFirebase();
}

// Save data to Firebase
function saveDataToFirebase() {
  if (!userId) {
    console.log('No user ID available, not saving to Firebase');
    return;
  }
  
  // Send command to UI to save data to Firebase
  figma.ui.postMessage({
    type: 'save-to-firebase',
    userId: userId,
    files: files
  });
  
  console.log('Sent data to UI for Firebase saving');
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
          file.totalTime = 0;
          Object.values(file.pages).forEach(page => {
            page.totalTime = 0;
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
  
  // If we're not tracking, start tracking on the current file
  if (!isTracking) {
    // Make sure we have current file and page info
    updateFileAndPage();
    
    // Start tracking the current file
    console.log(`Starting tracking due to user activity on ${currentFileName || 'unknown file'}`);
    startTracking();
  }
}

// Get Firebase configuration
async function getFirebaseConfig(): Promise<any> {
  // Default configuration or fetch from server
  return {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
    databaseURL: "https://YOUR_PROJECT_ID.firebaseio.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT_ID.appspot.com",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId: "YOUR_APP_ID"
  };
}

// Set up the plugin
async function initializePlugin() {
  console.log('Initializing plugin...');
  userId = await generateUserId();
  
  // Load Firebase config
  const firebaseConfig = await getFirebaseConfig();
  
  // Open the UI
  figma.showUI(__html__, { width: 360, height: 480 });
  
  // Send Firebase config to UI
  figma.ui.postMessage({
    type: 'firebase-config',
    config: firebaseConfig,
    userId: userId
  });
  
  console.log(`User ID: ${userId}`);
  
  // Load saved data
  loadPluginData();
  
  // Set up event listeners for user activity
  figma.on('selectionchange', () => {
    console.log('Selection changed, marking as active');
    handleActivity();
  });
  
  figma.on('currentpagechange', () => {
    console.log('Page changed');
    handleActivity();
    updateFileAndPage();
    updateFileData();
    updateTrackingStatus();
  });
  
  // File changes are caught by the interval below
  
  // Start activity check interval (check for user inactivity)
  activityInterval = setInterval(checkActivity, ACTIVITY_CHECK_INTERVAL);
  console.log(`Activity check interval set: ${ACTIVITY_CHECK_INTERVAL}ms`);
  
  // Start file check interval to detect file changes (more frequent)
  fileCheckInterval = setInterval(checkFileChange, FILE_CHECK_INTERVAL);
  console.log(`File check interval set: ${FILE_CHECK_INTERVAL}ms`);
  
  // Update file and page initially
  updateFileAndPage();
  updateFileData();
  
  // Start tracking automatically when plugin loads
  handleActivity();
  
  // Log the initialization
  console.log('Plugin initialized and tracking started');
}

// Handle messages from the UI
figma.ui.onmessage = (msg: any) => {
  console.log('Received message from UI:', msg.type);
  
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
      
    case 'ui-visibility-changed':
      // Handle visibility changes in the UI
      if (msg.isVisible === false && isTracking) {
        console.log('UI reports tab/window no longer visible, stopping tracking');
        stopTracking();
      }
      break;
      
    case 'firebase-data-loaded':
      // Handle data received from Firebase
      if (msg.files && Array.isArray(msg.files)) {
        console.log(`Received ${msg.files.length} files from Firebase`);
        
        // Merge Firebase data with local data
        mergeFirebaseData(msg.files);
        
        // Update UI with merged data
        savePluginData();
      }
      break;
  }
};

// Merge data from Firebase with local data
function mergeFirebaseData(firebaseFiles: FileData[]) {
  console.log(`Merging ${firebaseFiles.length} files from Firebase`);
  
  if (!firebaseFiles || firebaseFiles.length === 0) {
    console.log('No files to merge from Firebase');
    return;
  }
  
  firebaseFiles.forEach(firebaseFile => {
    // Find matching local file
    const localFile = files.find(f => f.id === firebaseFile.id);
    
    if (localFile) {
      // Update local file with Firebase data
      console.log(`Updating local file ${firebaseFile.id} with Firebase data`);
      
      // Use larger tracked time
      const totalTime = Math.max(localFile.totalTime, firebaseFile.totalTime);
      
      // Update file data
      localFile.name = firebaseFile.name;
      localFile.totalTime = totalTime;
      
      // Merge pages
      if (firebaseFile.pages && Object.keys(firebaseFile.pages).length > 0) {
        Object.entries(firebaseFile.pages).forEach(([pageId, pageData]) => {
          const localPage = localFile.pages[pageId];
          
          if (localPage) {
            // Use larger tracked time
            const trackedTime = Math.max(localPage.totalTime, pageData.totalTime);
            
            // Update page data
            localPage.name = pageData.name;
            localPage.totalTime = trackedTime;
          } else {
            // Add new page from Firebase
            localFile.pages[pageId] = {
              id: pageId,
              name: pageData.name,
              totalTime: pageData.totalTime
            };
          }
        });
      }
    } else {
      // Add new file from Firebase
      console.log(`Adding new file ${firebaseFile.id} from Firebase`);
      
      // Add the file to local files
      files.push(firebaseFile);
    }
  });
}

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

// Format time in HH:MM:SS
function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  const formattedHours = hours.toString().padStart(2, '0');
  const formattedMinutes = (minutes % 60).toString().padStart(2, '0');
  const formattedSeconds = (seconds % 60).toString().padStart(2, '0');
  
  return `${formattedHours}:${formattedMinutes}:${formattedSeconds}`;
}