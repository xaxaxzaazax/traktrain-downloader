/**
 * Content script for Traktrain Downloader
 * Extracts data from Traktrain pages for downloading
 */

/**
 * Listen for messages from popup script
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'extractData') {
        handleDataExtraction(request.type, request.createArtistFolder)
            .then(result => sendResponse(result))
            .catch(error => sendResponse({ success: false, error: error.message }));

        // Return true to indicate we will respond asynchronously
        return true;
    }
});

/**
 * Main function to handle data extraction
 * @param {string} type - 'single' or 'profile'
 * @param {boolean} createArtistFolder - Whether to create artist folder
 * @returns {Promise} Promise resolving to extracted data
 */
async function handleDataExtraction(type, createArtistFolder) {
    try {
        console.log('🎵 Starting data extraction for type:', type);
        const currentUrl = window.location.href;

        // Wait for page to be fully loaded
        await waitForPageLoad();
        
        // Add a small delay to ensure dynamic content is loaded
        await new Promise(resolve => setTimeout(resolve, 1000));

        if (type === 'single') {
            return await extractSingleBeat(currentUrl, createArtistFolder);
        } else if (type === 'profile') {
            return await extractProfileBeats(currentUrl, createArtistFolder);
        } else {
            throw new Error('Invalid extraction type');
        }
    } catch (error) {
        console.error('❌ Data extraction error:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Wait for page to be fully loaded
 */
function waitForPageLoad() {
    return new Promise((resolve) => {
        if (document.readyState === 'complete') {
            resolve();
        } else {
            window.addEventListener('load', resolve);
        }
    });
}

/**
 * Extract single beat information from current page
 * @param {string} url - Current page URL
 * @param {boolean} createArtistFolder - Whether to create artist folder
 * @returns {Promise} Promise resolving to beat data
 */
async function extractSingleBeat(url, createArtistFolder) {
    console.log('🎵 Extracting single beat from:', url);

    // If it's a short URL, we need to follow the redirect
    let realUrl = url;
    if (url.includes('traktra.in/t/')) {
        realUrl = await followRedirect(url);
    }

    console.log('🔗 Real URL:', realUrl);

    // Extract artist name from URL - handle different URL patterns
    let artist = extractArtistFromUrl(realUrl);
    
    // For single track URLs like /t/1377013, try to get artist from page content
    if (!artist || artist === 't') {
        console.log('🔍 Trying to extract artist from page content...');
        
        // Try to get artist from page title or meta tags
        const pageTitle = document.title;
        const titleMatch = pageTitle.match(/(.+?)\s*[-–—]\s*(.+)/);
        if (titleMatch) {
            artist = titleMatch[2].trim(); // Usually "Artist - Track" format
            console.log('👤 Artist from title:', artist);
        }
        
        // Fallback: try meta tags
        if (!artist) {
            const metaArtist = document.querySelector('meta[property="music:musician"], meta[name="artist"]');
            if (metaArtist) {
                artist = metaArtist.getAttribute('content');
                console.log('👤 Artist from meta:', artist);
            }
        }
        
        // Final fallback
        if (!artist) {
            artist = 'Unknown Artist';
            console.log('👤 Using fallback artist name');
        }
    }

    console.log('👤 Final artist:', artist);

    // Extract AWS base URL and track info from page HTML
    const html = document.documentElement.outerHTML;
    const awsBaseUrl = extractAwsBaseUrl(html);

    if (!awsBaseUrl) {
        throw new Error('Could not find AWS base URL on the page. Make sure you are on a Traktrain track page.');
    }

    console.log('🔗 AWS Base URL found:', awsBaseUrl);

    // Try multiple methods to extract track info (same as profile extraction)
    let trackInfo = null;
    
    // Method 1: Standard data-player-info
    console.log('🔍 Method 1: Looking for data-player-info...');
    trackInfo = extractTrackInfo(html);
    
    if (trackInfo) {
        console.log('✅ Found track via data-player-info:', trackInfo.name);
    } else {
        console.log('❌ No data-player-info found, trying alternative methods...');
        
        // Method 2: Look for track data in script tags
        console.log('🔍 Method 2: Searching script tags...');
        const scripts = document.querySelectorAll('script');
        
        for (const script of scripts) {
            const content = script.textContent || script.innerHTML;
            if (!content) continue;
            
            // Pattern 1: Look for track object
            const trackPatterns = [
                /"name"\s*:\s*"([^"]+)"[\s\S]*?"src"\s*:\s*"([^"]+)"/,
                /"title"\s*:\s*"([^"]+)"[\s\S]*?"url"\s*:\s*"([^"]+)"/,
                /"trackName"\s*:\s*"([^"]+)"[\s\S]*?"trackSrc"\s*:\s*"([^"]+)"/,
                /window\.track\s*=\s*{[\s\S]*?"name"\s*:\s*"([^"]+)"[\s\S]*?"src"\s*:\s*"([^"]+)"/
            ];
            
            for (const pattern of trackPatterns) {
                const match = content.match(pattern);
                if (match) {
                    trackInfo = {
                        name: match[1],
                        src: match[2]
                    };
                    console.log('✅ Found track via script pattern:', trackInfo.name);
                    break;
                }
            }
            
            if (trackInfo) break;
        }
        
        // Method 3: Try to extract from page elements
        if (!trackInfo) {
            console.log('🔍 Method 3: Extracting from page elements...');
            
            // Look for track name in page title or h1
            let trackName = null;
            const titleMatch = document.title.match(/(.+?)\s*[-–—]\s*(.+)/);
            if (titleMatch) {
                trackName = titleMatch[1].trim();
            } else {
                const h1 = document.querySelector('h1');
                if (h1) {
                    trackName = h1.textContent.trim();
                }
            }
            
            // Look for audio elements or data attributes
            const audioElements = document.querySelectorAll('audio[src], [data-src], [data-track-src]');
            for (const element of audioElements) {
                const src = element.src || element.getAttribute('data-src') || element.getAttribute('data-track-src');
                if (src && src.includes('.mp3')) {
                    // Extract relative path
                    const srcPath = src.replace(awsBaseUrl, '');
                    if (srcPath !== src) {
                        trackInfo = {
                            name: trackName || 'Unknown Track',
                            src: srcPath
                        };
                        console.log('✅ Found track via audio element:', trackInfo.name);
                        break;
                    }
                }
            }
        }
        
        // Method 4: Try to extract from URL structure
        if (!trackInfo) {
            console.log('🔍 Method 4: Trying URL-based extraction...');
            
            // For URLs like /t/1377013, try to find the track ID and construct
            const trackIdMatch = realUrl.match(/\/t\/(\d+)/);
            if (trackIdMatch) {
                const trackId = trackIdMatch[1];
                console.log('🆔 Track ID:', trackId);
                
                // Try to find any MP3 URLs in the page that might correspond to this track
                const mp3Matches = html.match(/https?:\/\/[^"'\s]+\.mp3/g);
                if (mp3Matches && mp3Matches.length > 0) {
                    const mp3Url = mp3Matches[0];
                    const srcPath = mp3Url.replace(awsBaseUrl, '');
                    
                    trackInfo = {
                        name: document.title.split(' - ')[0] || `Track ${trackId}`,
                        src: srcPath
                    };
                    console.log('✅ Found track via URL analysis:', trackInfo.name);
                }
            }
        }
    }

    if (!trackInfo) {
        throw new Error('Could not extract track information from the page. This might be a different type of Traktrain page or the page structure has changed.');
    }

    // Construct full download URL
    const downloadUrl = awsBaseUrl + trackInfo.src;
    console.log('🔗 Full download URL:', downloadUrl);

    return {
        success: true,
        data: {
            tracks: [{
                name: sanitizeFilename(trackInfo.name),
                url: downloadUrl,
                artist: artist
            }],
            artist: artist,
            createArtistFolder: createArtistFolder
        }
    };
}

/**
 * Extract all beats from a profile page
 * @param {string} url - Profile page URL
 * @param {boolean} createArtistFolder - Whether to create artist folder
 * @returns {Promise} Promise resolving to profile data
 */
async function extractProfileBeats(url, createArtistFolder) {
    console.log('Extracting profile beats from:', url);

    // Extract artist name from URL
    const artist = extractArtistFromUrl(url);
    if (!artist) {
        throw new Error('Could not extract artist name from URL');
    }

    console.log('Artist extracted:', artist);

    // Extract AWS base URL from page first
    const html = document.documentElement.outerHTML;
    const awsBaseUrl = extractAwsBaseUrl(html);

    if (!awsBaseUrl) {
        throw new Error('Could not find AWS base URL on the page. Make sure you are on a Traktrain page.');
    }

    console.log('AWS Base URL found:', awsBaseUrl);

    // Try multiple methods to find tracks
    const tracks = [];

    // Method 1: Look for data-player-info attributes (original method)
    console.log('🔍 Method 1: Looking for data-player-info attributes...');
    const trackElements = document.querySelectorAll('[data-player-info]');
    console.log(`Found ${trackElements.length} elements with data-player-info`);

    for (const element of trackElements) {
        try {
            const playerInfo = element.getAttribute('data-player-info');
            if (!playerInfo) {
                console.warn('Element has data-player-info attribute but no value');
                continue;
            }

            const trackData = JSON.parse(playerInfo);
            console.log('Parsed track data:', {
                name: trackData.name,
                src: trackData.src ? 'Present' : 'Missing',
                hasRequiredFields: !!(trackData.src && trackData.name)
            });

            if (trackData.src && trackData.name) {
                const fullUrl = awsBaseUrl + trackData.src;
                tracks.push({
                    name: sanitizeFilename(trackData.name),
                    url: fullUrl,
                    artist: artist
                });
                console.log('✅ Added track:', trackData.name, 'URL:', fullUrl);
            } else {
                console.warn('❌ Track missing required fields:', trackData);
            }
        } catch (error) {
            console.warn('❌ Failed to parse track data:', error);
        }
    }

    // Method 2: Look for JavaScript data in the page
    if (tracks.length === 0) {
        console.log('Method 2: Looking for JavaScript track data...');
        
        // Try to find tracks in JavaScript variables
        const jsTrackPatterns = [
            /window\.__INITIAL_STATE__\s*=\s*({.+?});/s,
            /window\.__PRELOADED_STATE__\s*=\s*({.+?});/s,
            /"tracks":\s*(\[.+?\])/s,
            /"beats":\s*(\[.+?\])/s,
            /var\s+tracks\s*=\s*(\[.+?\]);/s,
            /const\s+tracks\s*=\s*(\[.+?\]);/s
        ];

        for (const pattern of jsTrackPatterns) {
            const match = html.match(pattern);
            if (match) {
                try {
                    console.log('Found JS data pattern');
                    const data = JSON.parse(match[1]);
                    
                    // Extract tracks from different possible structures
                    let trackArray = [];
                    if (Array.isArray(data)) {
                        trackArray = data;
                    } else if (data.tracks) {
                        trackArray = data.tracks;
                    } else if (data.beats) {
                        trackArray = data.beats;
                    } else if (data.user && data.user.tracks) {
                        trackArray = data.user.tracks;
                    }

                    for (const track of trackArray) {
                        if (track.src && track.name) {
                            tracks.push({
                                name: sanitizeFilename(track.name),
                                url: awsBaseUrl + track.src,
                                artist: artist
                            });
                        }
                    }
                    
                    if (tracks.length > 0) {
                        console.log('Found', tracks.length, 'tracks in JS data');
                        break;
                    }
                } catch (error) {
                    console.warn('Failed to parse JS track data:', error);
                }
            }
        }
    }

    // Method 3: Look for individual data-player-info in the HTML using regex
    if (tracks.length === 0) {
        console.log('Method 3: Using regex to find data-player-info...');
        
        const playerInfoMatches = html.match(/data-player-info=['"]([^'"]+)['"]/g);
        if (playerInfoMatches) {
            console.log('Found', playerInfoMatches.length, 'data-player-info matches');
            
            for (const match of playerInfoMatches) {
                try {
                    const jsonMatch = match.match(/data-player-info=['"]([^'"]+)['"]/);
                    if (jsonMatch) {
                        const trackData = JSON.parse(jsonMatch[1]);
                        if (trackData.src && trackData.name) {
                            tracks.push({
                                name: sanitizeFilename(trackData.name),
                                url: awsBaseUrl + trackData.src,
                                artist: artist
                            });
                        }
                    }
                } catch (error) {
                    console.warn('Failed to parse regex track data:', error);
                }
            }
        }
    }

    console.log('Total tracks found:', tracks.length);

    if (tracks.length === 0) {
        // Provide more helpful error message
        const pageType = url.includes('/') && url.split('/').length > 4 ? 'individual track page' : 'profile page';
        throw new Error(`No tracks found on this ${pageType}. Make sure the page has loaded completely and try again. Debug info: AWS URL ${awsBaseUrl ? 'found' : 'missing'}, data-player-info elements: ${trackElements.length}`);
    }

    return {
        success: true,
        data: {
            tracks: tracks,
            artist: artist,
            createArtistFolder: createArtistFolder
        }
    };
}

/**
 * Follow redirect for short URLs
 * @param {string} shortUrl - Short URL to follow
 * @returns {Promise<string>} Promise resolving to real URL
 */
async function followRedirect(shortUrl) {
    try {
        const response = await fetch(shortUrl, {
            method: 'HEAD',
            redirect: 'follow'
        });
        return response.url;
    } catch (error) {
        console.error('Failed to follow redirect:', error);
        throw new Error('Could not resolve short URL');
    }
}

/**
 * Extract artist name from URL
 * @param {string} url - URL to extract artist from
 * @returns {string|null} Artist name or null if not found
 */
function extractArtistFromUrl(url) {
    try {
        const urlObj = new URL(url);
        const pathParts = urlObj.pathname.split('/').filter(part => part);
        return pathParts[0] || null;
    } catch (error) {
        console.error('Failed to parse URL:', error);
        return null;
    }
}

/**
 * Extract AWS base URL from HTML
 * @param {string} html - Page HTML
 * @returns {string|null} AWS base URL or null if not found
 */
function extractAwsBaseUrl(html) {
    const match = html.match(/var AWS_BASE_URL\s*=\s*['"]([^'"]+)['"]/);
    return match ? match[1] : null;
}

/**
 * Extract track information from HTML
 * @param {string} html - Page HTML
 * @returns {object|null} Track info object or null if not found
 */
function extractTrackInfo(html) {
    // Look for data-player-info attribute
    const match = html.match(/data-player-info=['"]([^'"]+)['"]/);
    if (!match) return null;

    try {
        const data = JSON.parse(match[1]);
        return {
            name: data.name || 'Unknown Track',
            src: data.src
        };
    } catch (error) {
        console.error('Failed to parse track info JSON:', error);
        return null;
    }
}

/**
 * Sanitize filename by removing invalid characters
 * @param {string} filename - Original filename
 * @returns {string} Sanitized filename
 */
function sanitizeFilename(filename) {
    return filename
        .replace(/[<>:"/\\|?*]/g, '') // Remove invalid characters
        .replace(/\s+/g, ' ') // Replace multiple spaces with single space
        .trim(); // Remove leading/trailing whitespace
}
