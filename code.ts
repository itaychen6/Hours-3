// This file holds the main code for plugins. Code in this file has access to
// the *figma document* via the figma global object.
// You can access browser APIs in the <script> tag inside "ui.html" which has a
// full browser environment (See https://www.figma.com/plugin-docs/how-plugins-run).

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyC5tcWk3ktDq8xd6fRXdNMupK9XPUTNpng",
  authDomain: "figma-time-track.firebaseapp.com",
  databaseURL: "https://figma-time-track-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "figma-time-track",
  storageBucket: "figma-time-track.firebasestorage.app",
  messagingSenderId: "747870447856",
  appId: "1:747870447856:web:e3f0151714603c51c1fa35",
  measurementId: "G-NVQL6S7K99"
};

// Plugin constants
const WIDTH = 320;
const HEIGHT = 500;

// Store files and pages in client storage for persistence
interface Project {
  id: string;
  name: string;
}

interface FileTracking {
  fileId: string;
  fileName: string;
  pages: PageTracking[];
  totalTrackedTime: number; // Total time in seconds
  lastActive?: number; // Timestamp of last activity
  isActive: boolean; // Whether this file is currently active
}

interface PageTracking {
  pageId: string;
  pageName: string;
  trackedTime: number; // Time in seconds
  lastStartTime?: number; // Timestamp when tracking started for this page
  isActive: boolean; // Whether this page is currently active
}

interface PluginData {
  files: FileTracking[];
  userId: string;
  lastActiveTimestamp?: number;
  activeFileId?: string; // Currently active file ID
  activePageId?: string; // Currently active page ID
}

interface TimeEntry {
  fileId: string;
  fileName: string;
  pageId: string;
  pageName: string;
  startTime: number;
  endTime?: number;
  duration?: number;
}

// Message types for plugin communication
interface PluginMessage {
  type: string;
  [key: string]: any;
}

// Initialize the plugin
figma.showUI(__html__, { width: WIDTH, height: HEIGHT });
figma.ui.resize(WIDTH, HEIGHT);

// Generate or retrieve a user ID
function getUserId(): string {
  try {
    if (figma.currentUser) {
      return 'user_' + figma.currentUser.id;
    }
  } catch (error) {
    console.error('Error accessing current user:', error);
  }
  
  // Fallback: generate random ID
  return 'user_' + Math.random().toString(36).substring(2, 15);
}

// Initialize plugin data
let pluginData: PluginData = figma.root.getPluginData('timeTrackerData') 
  ? JSON.parse(figma.root.getPluginData('timeTrackerData'))
  : { 
      files: [],
      userId: getUserId(),
      lastActiveTimestamp: Date.now()
    };

// Save plugin data
function savePluginData(): void {
  figma.root.setPluginData('timeTrackerData', JSON.stringify(pluginData));
  
  // Also send updated data to UI for display
  figma.ui.postMessage({
    type: 'files-updated',
    files: pluginData.files
  });
}

// Track active time entry
let activeTimeEntry: TimeEntry | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
const IDLE_TIMEOUT = 5 * 60 * 1000; // 5 minutes in milliseconds

// Store the previous file key to detect file changes
let previousFileKey: string | null = null;

// Get current file info
function getCurrentFileInfo(): { fileId: string, fileName: string } {
  // Use the document URL to get the file ID and name
  const fileId = figma.fileKey || 'unknown_file';
  const fileName = figma.root.name || 'Untitled';
  
  return { fileId, fileName };
}

// Get current page info
function getCurrentPageInfo(): { pageId: string, pageName: string } {
  const pageId = figma.currentPage.id;
  const pageName = figma.currentPage.name;
  
  return { pageId, pageName };
}

// Find or create file tracking object
function getFileTracking(fileId: string, fileName: string): FileTracking {
  // Find existing file tracking
  let fileTracking = pluginData.files.find(f => f.fileId === fileId);
  
  // If not found, create a new one
  if (!fileTracking) {
    fileTracking = {
      fileId,
      fileName,
      pages: [],
      totalTrackedTime: 0,
      lastActive: Date.now(),
      isActive: true
    };
    pluginData.files.push(fileTracking);
  }
  
  // Update file name in case it changed
  fileTracking.fileName = fileName;
  
  return fileTracking;
}

// Find or create page tracking object
function getPageTracking(fileTracking: FileTracking, pageId: string, pageName: string): PageTracking {
  // Find existing page tracking
  let pageTracking = fileTracking.pages.find(p => p.pageId === pageId);
  
  // If not found, create a new one
  if (!pageTracking) {
    pageTracking = {
      pageId,
      pageName,
      trackedTime: 0,
      isActive: true
    };
    fileTracking.pages.push(pageTracking);
  }
  
  // Update page name in case it changed
  pageTracking.pageName = pageName;
  
  return pageTracking;
}

// Deactivate all files and pages
function deactivateAllFilesAndPages(): void {
  pluginData.files.forEach(file => {
    file.isActive = false;
    file.pages.forEach(page => {
      page.isActive = false;
    });
  });
}

// Start tracking time for the current file and page
function startTrackingCurrentFileAndPage(): void {
  // Get current file and page information
  const { fileId, fileName } = getCurrentFileInfo();
  const { pageId, pageName } = getCurrentPageInfo();

  // If we're already tracking this file/page, just continue
  if (activeTimeEntry && 
      activeTimeEntry.fileId === fileId && 
      activeTimeEntry.pageId === pageId) {
    return;
  }
  
  // Stop tracking the previous file/page if we were tracking
  if (activeTimeEntry) {
    stopTracking();
  }
  
  // Deactivate all files and pages
  deactivateAllFilesAndPages();
  
  // Set the current file and page as active
  pluginData.activeFileId = fileId;
  pluginData.activePageId = pageId;
  
  // Get or create the file and page tracking objects
  const fileTracking = getFileTracking(fileId, fileName);
  const pageTracking = getPageTracking(fileTracking, pageId, pageName);
  
  // Mark as active
  fileTracking.isActive = true;
  pageTracking.isActive = true;
  
  // Create a new time entry
  activeTimeEntry = {
    fileId,
    fileName,
    pageId,
    pageName,
    startTime: Date.now()
  };
  
  // Mark the start time
  pageTracking.lastStartTime = activeTimeEntry.startTime;
  fileTracking.lastActive = activeTimeEntry.startTime;
  
  // Update the previous file key
  previousFileKey = fileId;
  
  // Save data
  savePluginData();
  
  // Update the UI
  figma.ui.postMessage({
    type: 'tracking-status',
    isTracking: true,
    fileId,
    fileName,
    pageId,
    pageName,
    startTime: activeTimeEntry.startTime
  });
  
  // Start the idle timer
  startIdleTimer();
}

// Stop tracking time and save the entry
function stopTracking(): void {
  if (!activeTimeEntry) return;
  
  console.log(`Stopping tracking for ${activeTimeEntry.fileName} - ${activeTimeEntry.pageName}`);
  
  const endTime = Date.now();
  const duration = Math.round((endTime - activeTimeEntry.startTime) / 1000); // duration in seconds
  
  // Only save if the duration is significant (more than 1 second)
  if (duration > 1) {
    // Get the file and page tracking objects
    const fileTracking = getFileTracking(activeTimeEntry.fileId, activeTimeEntry.fileName);
    const pageTracking = getPageTracking(fileTracking, activeTimeEntry.pageId, activeTimeEntry.pageName);
    
    // Update tracked times
    pageTracking.trackedTime += duration;
    pageTracking.lastStartTime = undefined; // No longer tracking
    
    // Update total file time
    fileTracking.totalTrackedTime += duration;
    
    // Save the data
    savePluginData();
    
    // Also send tracking data to UI for Firebase storage
    figma.ui.postMessage({
      type: 'save-time-entry',
      timeEntry: {
        fileId: activeTimeEntry.fileId,
        fileName: activeTimeEntry.fileName,
        pageId: activeTimeEntry.pageId,
        pageName: activeTimeEntry.pageName,
        startTime: activeTimeEntry.startTime,
        endTime: endTime,
        duration: duration
      }
    });
  }
  
  activeTimeEntry = null;
  
  // Update the UI
  figma.ui.postMessage({
    type: 'tracking-status',
    isTracking: false
  });
  
  // Clear the idle timer
  if (idleTimer !== null) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

// Check if the file has changed
function checkFileChange(): void {
  const { fileId } = getCurrentFileInfo();
  
  // If file key changed (user switched files)
  if (previousFileKey !== null && previousFileKey !== fileId) {
    console.log(`File changed from ${previousFileKey} to ${fileId}`);
    
    // Handle the file change
    handleFileChange(fileId);
  }
  
  // Update previous file key
  previousFileKey = fileId;
}

// Handle file change
function handleFileChange(newFileId: string): void {
  console.log(`Handling file change to ${newFileId}`);

  // Stop tracking the previous file if we were tracking
  if (activeTimeEntry) {
    // Explicitly stop tracking the current file
    stopTracking();
  }
  
  // Deactivate all files and pages
  deactivateAllFilesAndPages();
  
  // Get current file and page information
  const { fileId, fileName } = getCurrentFileInfo();
  const { pageId, pageName } = getCurrentPageInfo();
  
  // Get or create file tracking
  const fileTracking = getFileTracking(fileId, fileName);
  
  // Mark file as active
  fileTracking.isActive = true;
  pluginData.activeFileId = fileId;
  
  // Find the current page in this file
  let pageTracking = fileTracking.pages.find(p => p.pageId === pageId);
  if (pageTracking) {
    pageTracking.isActive = true;
    pluginData.activePageId = pageId;
  }
  
  // Save the active status changes
  savePluginData();
  
  // Start tracking the new file
  startTrackingCurrentFileAndPage();
}

// Start the idle timer
function startIdleTimer(): void {
  // Clear any existing timer
  if (idleTimer !== null) {
    clearTimeout(idleTimer);
  }
  
  // Set a new timer
  idleTimer = setTimeout(() => {
    // If we're still tracking after the timeout, stop tracking
    if (activeTimeEntry) {
      stopTracking();
    }
    
    idleTimer = null;
  }, IDLE_TIMEOUT);
}

// Reset the idle timer on user activity
function resetIdleTimer(): void {
  // Check if file has changed
  checkFileChange();
  
  // Only reset if we're actively tracking
  if (activeTimeEntry) {
    // Update the last active timestamp
    pluginData.lastActiveTimestamp = Date.now();
    savePluginData();
    
    // Restart the idle timer
    startIdleTimer();
  }
}

// Handle page change
function handlePageChange(): void {
  // Stop tracking the previous page if we were tracking
  if (activeTimeEntry) {
    stopTracking();
  }
  
  // Start tracking the new page
  startTrackingCurrentFileAndPage();
}

// Initialize event listeners for activity tracking
async function initializeEventListeners() {
  try {
    // Make sure to load all pages before registering document change handlers
    await figma.loadAllPagesAsync();
    
    // Listen for user activity events in Figma
    figma.on('selectionchange', resetIdleTimer);
    figma.on('documentchange', resetIdleTimer);
    
    // Listen for page changes
    figma.on('currentpagechange', handlePageChange);
    
    // Start tracking the current file and page
    startTrackingCurrentFileAndPage();
    
    // Set up a periodic check for file changes (every 3 seconds)
    setInterval(checkFileChange, 3000);
    
    console.log('Event listeners initialized successfully');
  } catch (error) {
    console.error('Error initializing event listeners:', error);
  }
}

// Call the initialize function
initializeEventListeners();

// Handle messages from the UI
figma.ui.onmessage = (msg: any) => {
  const message = msg as PluginMessage;
  
  switch (message.type) {
    case 'check-tracking-status':
      // Check if current file is different from last active file
      const { fileId } = getCurrentFileInfo();
      if (pluginData.activeFileId && pluginData.activeFileId !== fileId) {
        // Handle file change if we returned to a different file
        console.log(`Detected file change on check: from ${pluginData.activeFileId} to ${fileId}`);
        handleFileChange(fileId);
      } else {
        // If same file but no active tracking, start tracking
        if (!activeTimeEntry && fileId) {
          console.log(`No active tracking, starting for ${fileId}`);
          startTrackingCurrentFileAndPage();
        }
      }
    
      // Check if there's an active time tracking session
      if (activeTimeEntry) {
        figma.ui.postMessage({
          type: 'tracking-status',
          isTracking: true,
          fileId: activeTimeEntry.fileId,
          fileName: activeTimeEntry.fileName,
          pageId: activeTimeEntry.pageId,
          pageName: activeTimeEntry.pageName,
          startTime: activeTimeEntry.startTime
        });
      } else {
        figma.ui.postMessage({
          type: 'tracking-status',
          isTracking: false
        });
      }

      // Send files list to UI
      figma.ui.postMessage({
        type: 'files-updated',
        files: pluginData.files
      });

      // Let the UI know Firebase is ready for communication
      figma.ui.postMessage({
        type: 'firebase-config',
        config: firebaseConfig,
        userId: pluginData.userId
      });
      break;
      
    case 'resume-tracking':
      startTrackingCurrentFileAndPage();
      break;
      
    case 'cancel':
      // Stop tracking before closing the plugin
      stopTracking();
      figma.closePlugin();
      break;
  }
};