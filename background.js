/**
 * Background script (service worker) for Traktrain Downloader
 * Handles download operations using Chrome's downloads API
 */

/**
 * Listen for messages from popup script
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'downloadTracks') {
        handleDownloadTracks(request)
            .then(result => sendResponse(result))
            .catch(error => sendResponse({ success: false, error: error.message }));

        // Return true to indicate we will respond asynchronously
        return true;
    }
});

/**
 * Handle track downloads
 * @param {object} request - Download request containing tracks data
 * @returns {Promise} Promise resolving to download result
 */
async function handleDownloadTracks(request) {
    const { data, type, createArtistFolder } = request;
    const { tracks, artist } = data;

    try {
        if (tracks.length === 1) {
            // Single track download
            return await downloadSingleTrack(tracks[0], artist, createArtistFolder);
        } else {
            // Multiple tracks download
            return await downloadMultipleTracks(tracks, artist, createArtistFolder);
        }
    } catch (error) {
        console.error('Download error:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Download a single track
 * @param {object} track - Track object with name and url
 * @param {string} artist - Artist name
 * @param {boolean} createArtistFolder - Whether to create artist folder
 * @returns {Promise} Promise resolving to download result
 */
async function downloadSingleTrack(track, artist, createArtistFolder) {
    console.log('🎵 Downloading single track:', track.name);
    console.log('🔗 Download URL:', track.url);

    // Prepare filename
    const filename = createArtistFolder
        ? `${artist}/${track.name}.mp3`
        : `${track.name}.mp3`;

    try {
        // Method 1: Try direct download with enhanced headers
        console.log('🔄 Attempting direct download with bypass headers...');
        const downloadId = await chrome.downloads.download({
            url: track.url,
            filename: filename,
            headers: [
                {
                    name: 'Referer',
                    value: 'https://traktrain.com/'
                },
                {
                    name: 'Origin',
                    value: 'https://traktrain.com'
                },
                {
                    name: 'User-Agent',
                    value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                },
                {
                    name: 'Accept',
                    value: 'audio/mpeg, audio/*, */*'
                },
                {
                    name: 'Sec-Fetch-Dest',
                    value: 'audio'
                },
                {
                    name: 'Sec-Fetch-Mode',
                    value: 'cors'
                },
                {
                    name: 'Sec-Fetch-Site',
                    value: 'cross-site'
                }
            ],
            saveAs: false
        });

        console.log('✅ Download started with ID:', downloadId);
        
        // Monitor download progress
        monitorDownloadProgress(downloadId);

        return {
            success: true,
            message: `Started download: ${track.name}`,
            downloadId: downloadId
        };
        
    } catch (error) {
        console.error('❌ Direct download failed:', error);
        
        // Method 2: Fallback - try with different headers
        try {
            console.log('🔄 Trying fallback download method...');
            const downloadId = await chrome.downloads.download({
                url: track.url,
                filename: filename,
                headers: [
                    {
                        name: 'Referer',
                        value: 'https://traktrain.com/'
                    }
                ],
                saveAs: false
            });

            console.log('✅ Fallback download started with ID:', downloadId);
            monitorDownloadProgress(downloadId);

            return {
                success: true,
                message: `Started download (fallback): ${track.name}`,
                downloadId: downloadId
            };
            
        } catch (fallbackError) {
            console.error('❌ Fallback download also failed:', fallbackError);
            
            // Method 3: Content script injection method
            return await tryContentScriptDownload(track, filename);
        }
    }
}

/**
 * Fallback download method using content script injection
 */
async function tryContentScriptDownload(track, filename) {
    try {
        console.log('🔄 Trying content script download method...');
        
        // Get the active tab
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs.length === 0) {
            throw new Error('No active tab found');
        }
        
        // Inject full stealth download system into the page
        const result = await chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            func: function(url, filename) {
                return new Promise(async (resolve) => {
                    console.log('🕵️ Starting stealth download system:', filename);
                    
                    // Stealth Method 1: Web Worker download
                    async function downloadWithWebWorker(url, filename) {
                        try {
                            const workerCode = `
                                self.addEventListener('message', async function(e) {
                                    const { url } = e.data;
                                    try {
                                        const response = await fetch(url, {
                                            headers: {
                                                'Referer': 'https://traktrain.com/',
                                                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                                                'Cache-Control': 'no-cache'
                                            }
                                        });
                                        if (response.ok) {
                                            const blob = await response.blob();
                                            self.postMessage({ success: true, blob: blob });
                                        } else {
                                            self.postMessage({ success: false, error: 'HTTP ' + response.status });
                                        }
                                    } catch (error) {
                                        self.postMessage({ success: false, error: error.message });
                                    }
                                });
                            `;
                            
                            const blob = new Blob([workerCode], { type: 'application/javascript' });
                            const worker = new Worker(URL.createObjectURL(blob));
                            
                            const workerResult = await new Promise((workerResolve) => {
                                worker.addEventListener('message', function(e) {
                                    worker.terminate();
                                    workerResolve(e.data);
                                });
                                worker.postMessage({ url });
                                setTimeout(() => {
                                    worker.terminate();
                                    workerResolve({ success: false, error: 'timeout' });
                                }, 15000);
                            });
                            
                            if (workerResult.success) {
                                const downloadUrl = URL.createObjectURL(workerResult.blob);
                                const a = document.createElement('a');
                                a.href = downloadUrl;
                                a.download = filename;
                                a.click();
                                URL.revokeObjectURL(downloadUrl);
                                console.log('✅ Web Worker download success');
                                return true;
                            }
                        } catch (error) {
                            console.log('❌ Web Worker failed:', error);
                        }
                        return false;
                    }
                    
                    // Stealth Method 2: Chunked stream download
                    async function downloadWithChunkedStream(url, filename) {
                        try {
                            const headResponse = await fetch(url, {
                                method: 'HEAD',
                                headers: {
                                    'Referer': 'https://traktrain.com/',
                                    'Range': 'bytes=0-1'
                                }
                            });
                            
                            if (!headResponse.ok) return false;
                            
                            const contentLength = parseInt(headResponse.headers.get('content-length') || '0');
                            const chunkSize = 1024 * 1024; // 1MB chunks
                            const chunks = [];
                            
                            console.log(`📊 Chunked download: ${contentLength} bytes`);
                            
                            for (let start = 0; start < contentLength; start += chunkSize) {
                                const end = Math.min(start + chunkSize - 1, contentLength - 1);
                                
                                const response = await fetch(url, {
                                    headers: {
                                        'Referer': 'https://traktrain.com/',
                                        'Range': `bytes=${start}-${end}`
                                    }
                                });
                                
                                if (response.ok) {
                                    const chunk = await response.arrayBuffer();
                                    chunks.push(chunk);
                                    await new Promise(resolve => setTimeout(resolve, 50));
                                } else {
                                    throw new Error(`Chunk failed: ${response.status}`);
                                }
                            }
                            
                            const fullBuffer = new Uint8Array(contentLength);
                            let offset = 0;
                            for (const chunk of chunks) {
                                fullBuffer.set(new Uint8Array(chunk), offset);
                                offset += chunk.byteLength;
                            }
                            
                            const blob = new Blob([fullBuffer], { type: 'audio/mpeg' });
                            const downloadUrl = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = downloadUrl;
                            a.download = filename;
                            a.click();
                            URL.revokeObjectURL(downloadUrl);
                            
                            console.log('✅ Chunked download success');
                            return true;
                            
                        } catch (error) {
                            console.log('❌ Chunked download failed:', error);
                            return false;
                        }
                    }
                    
                    // Stealth Method 3: Iframe isolation
                    async function downloadWithIframe(url, filename) {
                        try {
                            const iframe = document.createElement('iframe');
                            iframe.style.display = 'none';
                            document.body.appendChild(iframe);
                            
                            const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                            iframeDoc.open();
                            iframeDoc.write(`
                                <script>
                                    fetch('${url}', {
                                        method: 'GET',
                                        headers: {
                                            'Referer': 'https://traktrain.com/',
                                            'Cache-Control': 'no-cache'
                                        }
                                    })
                                    .then(response => response.blob())
                                    .then(blob => {
                                        const url = URL.createObjectURL(blob);
                                        const a = document.createElement('a');
                                        a.href = url;
                                        a.download = '${filename}';
                                        a.click();
                                        URL.revokeObjectURL(url);
                                        parent.postMessage('download-success', '*');
                                    })
                                    .catch(error => {
                                        parent.postMessage('download-error', '*');
                                    });
                                </script>
                            `);
                            iframeDoc.close();
                            
                            const success = await new Promise((iframeResolve) => {
                                const messageHandler = (event) => {
                                    if (event.data.startsWith('download-')) {
                                        window.removeEventListener('message', messageHandler);
                                        document.body.removeChild(iframe);
                                        iframeResolve(event.data === 'download-success');
                                    }
                                };
                                window.addEventListener('message', messageHandler);
                                setTimeout(() => {
                                    window.removeEventListener('message', messageHandler);
                                    document.body.removeChild(iframe);
                                    iframeResolve(false);
                                }, 10000);
                            });
                            
                            if (success) {
                                console.log('✅ Iframe download success');
                                return true;
                            }
                        } catch (error) {
                            console.log('❌ Iframe download failed:', error);
                        }
                        return false;
                    }
                    
                    // Stealth Method 4: Direct fetch with stealth headers
                    async function downloadWithStealthFetch(url, filename) {
                        try {
                            const response = await fetch(url, {
                                headers: {
                                    'Referer': 'https://traktrain.com/',
                                    'Cache-Control': 'no-cache',
                                    'Pragma': 'no-cache',
                                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                                }
                            });
                            
                            if (response.ok) {
                                const blob = await response.blob();
                                const downloadUrl = URL.createObjectURL(blob);
                                const a = document.createElement('a');
                                a.href = downloadUrl;
                                a.download = filename;
                                a.click();
                                URL.revokeObjectURL(downloadUrl);
                                console.log('✅ Stealth fetch success');
                                return true;
                            }
                        } catch (error) {
                            console.log('❌ Stealth fetch failed:', error);
                        }
                        return false;
                    }
                    
                    // Try all stealth methods in sequence
                    const methods = [
                        { name: 'Web Worker', func: downloadWithWebWorker },
                        { name: 'Chunked Stream', func: downloadWithChunkedStream },
                        { name: 'Iframe Isolation', func: downloadWithIframe },
                        { name: 'Stealth Fetch', func: downloadWithStealthFetch }
                    ];
                    
                    for (const method of methods) {
                        console.log(`🔄 Trying stealth method: ${method.name}`);
                        try {
                            const success = await method.func(url, filename);
                            if (success) {
                                resolve({ success: true, message: `Downloaded via ${method.name}` });
                                return;
                            }
                        } catch (error) {
                            console.log(`❌ ${method.name} failed:`, error);
                        }
                        
                        // Small delay between methods
                        await new Promise(r => setTimeout(r, 500));
                    }
                    
                    // Final fallback - simple link click
                    console.log('🔄 Final fallback: simple link click');
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = filename;
                    a.style.display = 'none';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    
                    resolve({ success: true, message: 'Download triggered (fallback)' });
                });
            },
            args: [track.url, filename]
        });
        
        if (result && result[0] && result[0].success) {
            console.log('✅ Content script download triggered');
            return {
                success: true,
                message: `Started download (content script): ${track.name}`,
                downloadId: null
            };
        } else {
            throw new Error('Content script download failed');
        }
        
    } catch (error) {
        console.error('❌ All download methods failed:', error);
        return {
            success: false,
            error: `All download methods failed for ${track.name}: ${error.message}`
        };
    }
}

/**
 * Download multiple tracks
 * @param {Array} tracks - Array of track objects
 * @param {string} artist - Artist name
 * @param {boolean} createArtistFolder - Whether to create artist folder
 * @returns {Promise} Promise resolving to download result
 */
async function downloadMultipleTracks(tracks, artist, createArtistFolder) {
    console.log(`Downloading ${tracks.length} tracks for ${artist}`);

    const downloadPromises = tracks.map((track, index) => {
        return new Promise((resolve, reject) => {
            setTimeout(async () => {
                try {
                    // Prepare filename
                    const filename = createArtistFolder
                        ? `${artist}/${track.name}.mp3`
                        : `${track.name}.mp3`;

                    // Use stealth download for each track
                    const stealthResult = await tryContentScriptDownload(track, filename);

                    if (stealthResult.success) {
                        resolve({ success: true, downloadId: null, track: track.name, method: stealthResult.message });
                    } else {
                        reject(new Error(stealthResult.error || 'Stealth download failed'));
                    }
                } catch (error) {
                    reject(error);
                }
            }, index * 1000); // Stagger downloads by 1 second to avoid overwhelming
        });
    });

    try {
        const results = await Promise.allSettled(downloadPromises);

        const successful = results.filter(result =>
            result.status === 'fulfilled' && result.value.success
        ).length;

        const failed = results.filter(result => result.status === 'rejected').length;

        return {
            success: successful > 0,
            message: `Downloaded ${successful} tracks${failed > 0 ? `, ${failed} failed` : ''}`,
            results: results
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * Monitor download progress and notify popup
 * @param {number} downloadId - Chrome downloads API ID
 * @param {number} totalTracks - Total number of tracks (for progress calculation)
 * @param {number} currentTrack - Current track number (for progress calculation)
 */
function monitorDownloadProgress(downloadId, totalTracks = 1, currentTrack = 1) {
    // Get initial download info
    chrome.downloads.search({ id: downloadId }, (results) => {
        if (results.length === 0) return;

        const download = results[0];
        updateProgress(download, totalTracks, currentTrack);
    });

    // Listen for download updates
    const onChangedListener = (delta) => {
        if (delta.id === downloadId) {
            chrome.downloads.search({ id: downloadId }, (results) => {
                if (results.length === 0) return;

                const download = results[0];
                updateProgress(download, totalTracks, currentTrack);

                // Remove listener when download is complete
                if (download.state === 'complete' || download.state === 'interrupted') {
                    chrome.downloads.onChanged.removeListener(onChangedListener);

                    if (download.state === 'complete') {
                        notifyPopup('downloadComplete', {
                            message: `Download completed: ${download.filename}`
                        });
                    } else if (download.state === 'interrupted') {
                        notifyPopup('downloadError', {
                            message: `Download failed: ${download.filename}`
                        });
                    }
                }
            });
        }
    };

    chrome.downloads.onChanged.addListener(onChangedListener);
}

/**
 * Update progress in popup
 * @param {object} download - Download object from Chrome API
 * @param {number} totalTracks - Total number of tracks
 * @param {number} currentTrack - Current track number
 */
function updateProgress(download, totalTracks, currentTrack) {
    let progress = 0;
    let statusText = '';

    if (download.state === 'in_progress' && download.totalBytes > 0) {
        const bytesProgress = (download.bytesReceived / download.totalBytes) * 100;
        const trackProgress = ((currentTrack - 1) / totalTracks) * 100;
        progress = trackProgress + (bytesProgress / totalTracks);

        if (totalTracks === 1) {
            statusText = `Downloading... ${Math.round(bytesProgress)}%`;
        } else {
            statusText = `Track ${currentTrack}/${totalTracks}: ${Math.round(bytesProgress)}%`;
        }
    } else if (download.state === 'complete') {
        progress = 100;
        statusText = 'Download complete!';
    } else if (download.state === 'interrupted') {
        statusText = 'Download interrupted';
    }

    notifyPopup('updateProgress', {
        percentage: Math.round(progress),
        text: statusText
    });
}

/**
 * Notify popup of download status
 * @param {string} action - Action type
 * @param {object} data - Data to send
 */
function notifyPopup(action, data) {
    // Send message to all active popups
    chrome.runtime.sendMessage({
        action: action,
        ...data
    }).catch(() => {
        // Ignore errors if no popup is listening
    });
}

/**
 * Handle download interruptions and retries
 * @param {number} downloadId - Download ID to retry
 */
async function retryDownload(downloadId) {
    try {
        const results = await chrome.downloads.search({ id: downloadId });
        if (results.length === 0) return;

        const download = results[0];
        if (download.canResume) {
            await chrome.downloads.resume(downloadId);
        } else {
            // Restart the download
            await chrome.downloads.download({
                url: download.url,
                filename: download.filename,
                headers: download.headers,
                saveAs: false
            });
        }
    } catch (error) {
        console.error('Retry failed:', error);
    }
}

// Export functions for testing (in development)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        handleDownloadTracks,
        downloadSingleTrack,
        downloadMultipleTracks,
        monitorDownloadProgress
    };
}

