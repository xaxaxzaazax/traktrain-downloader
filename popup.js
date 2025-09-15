/**
 * Popup script for Traktrain Downloader extension
 * Handles user interface interactions and communicates with background script
 */

// DOM elements
const downloadSingleBtn = document.getElementById('download-single');
const downloadProfileBtn = document.getElementById('download-profile');
const statusDiv = document.getElementById('status');
const statusText = document.getElementById('status-text');
const progressContainer = document.getElementById('progress-container');
const progressFill = document.getElementById('progress-fill');
const progressText = document.getElementById('progress-text');
const createArtistFolderCheckbox = document.getElementById('create-artist-folder');

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', initializePopup);

/**
 * Initialize the popup interface
 */
function initializePopup() {
    // Set up event listeners
    downloadSingleBtn.addEventListener('click', () => handleDownload('single'));
    downloadProfileBtn.addEventListener('click', () => handleDownload('profile'));

    // Check if we're on a Traktrain page
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const currentTab = tabs[0];
        const isTraktrainPage = currentTab.url.includes('traktrain.com') || currentTab.url.includes('traktra.in');

        if (!isTraktrainPage) {
            showStatus('Please navigate to a Traktrain page first.', 'error');
            disableButtons();
        } else {
            showStatus('Ready to download from Traktrain!', 'success');
        }
    });
}

/**
 * Handle download button clicks
 * @param {string} type - 'single' or 'profile'
 */
async function handleDownload(type) {
    try {
        // Show progress indicator
        showProgress();

        // Get current tab
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        // Send message to content script to extract data
        const response = await chrome.tabs.sendMessage(tab.id, {
            action: 'extractData',
            type: type,
            createArtistFolder: createArtistFolderCheckbox.checked
        });

        if (response.success) {
            // Show how many tracks were found
            const trackCount = response.data.tracks ? response.data.tracks.length : 0;
            showStatus(`Found ${trackCount} track${trackCount !== 1 ? 's' : ''}. Starting download...`, 'info');

            // Send data to background script for downloading
            const downloadResponse = await chrome.runtime.sendMessage({
                action: 'downloadTracks',
                data: response.data,
                type: type,
                createArtistFolder: createArtistFolderCheckbox.checked
            });

            if (downloadResponse.success) {
                showStatus(`Successfully started download of ${trackCount} track${trackCount !== 1 ? 's' : ''}!`, 'success');
            } else {
                showStatus(`Download failed: ${downloadResponse.error}`, 'error');
            }
        } else {
            // Show detailed error message
            const errorMsg = response.error || 'Unknown error occurred';
            showStatus(`Failed to extract data: ${errorMsg}`, 'error');
            
            // Log detailed error for debugging
            console.error('Data extraction failed:', response);
        }

    } catch (error) {
        console.error('Download error:', error);
        showStatus('An error occurred during download.', 'error');
    }

    // Hide progress after a delay
    setTimeout(() => {
        hideProgress();
    }, 2000);
}

/**
 * Show status message to user
 * @param {string} message - The message to display
 * @param {string} type - 'success', 'error', or 'info'
 */
function showStatus(message, type = 'info') {
    statusText.textContent = message;
    statusDiv.className = `status ${type}`;
    statusDiv.classList.remove('hidden');
}

/**
 * Hide status message
 */
function hideStatus() {
    statusDiv.classList.add('hidden');
}

/**
 * Show progress indicator
 */
function showProgress() {
    progressContainer.classList.remove('hidden');
    downloadSingleBtn.disabled = true;
    downloadProfileBtn.disabled = true;
}

/**
 * Hide progress indicator
 */
function hideProgress() {
    progressContainer.classList.add('hidden');
    downloadSingleBtn.disabled = false;
    downloadProfileBtn.disabled = false;
}

/**
 * Disable download buttons
 */
function disableButtons() {
    downloadSingleBtn.disabled = true;
    downloadProfileBtn.disabled = true;
}

/**
 * Update progress bar
 * @param {number} percentage - Progress percentage (0-100)
 * @param {string} text - Progress text to display
 */
function updateProgress(percentage, text = '') {
    progressFill.style.width = `${percentage}%`;
    if (text) {
        progressText.textContent = text;
    }
}

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'updateProgress') {
        updateProgress(message.percentage, message.text);
    } else if (message.action === 'downloadComplete') {
        showStatus(message.message, 'success');
        hideProgress();
    } else if (message.action === 'downloadError') {
        showStatus(message.message, 'error');
        hideProgress();
    }
});

