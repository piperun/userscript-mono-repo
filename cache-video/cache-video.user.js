// ==UserScript==
// @name         Iwara Video Cache
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Caches videos on iwara.tv to avoid bandwidth limitations.
// @author       Piperun
// @noframes
// @match        *://*.iwara.tv/*
// @grant        unsafe-eval
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_download
// ==/UserScript==

(function () {
    'use strict';

    const CACHE_EXPIRATION_DAYS = 7;

    function dataURLtoBlob(dataurl) {
        var arr = dataurl.split(','),
            mime = arr[0].match(/:(.*?);/)[1],
            bstr = atob(arr[1]),
            n = bstr.length,
            u8arr = new Uint8Array(n);
        while (n--) {
            u8arr[n] = bstr.charCodeAt(n);
        }
        return new Blob([u8arr], { type: mime });
    }

    // Function to check if a URL is expired
    function isCacheExpired(cacheTimestamp) {
        if (!cacheTimestamp) {
            return true;
        }
        const expirationTime = CACHE_EXPIRATION_DAYS * 24 * 60 * 60 * 1000;
        return (Date.now() - cacheTimestamp) > expirationTime;
    }

    // Function to get the video from cache or fetch and cache it
    function getAndCacheVideo(videoUrl) {
        const cachedVideo = GM_getValue(videoUrl);

        if (cachedVideo && !isCacheExpired(cachedVideo.timestamp)) {
            console.log('Loading video from cache');
            const blob = dataURLtoBlob(cachedVideo.data);
            const blobUrl = URL.createObjectURL(blob);
            setVideoSource(blobUrl);
        } else {
            console.log('Fetching video and caching it');
            GM_xmlhttpRequest({
                method: 'GET',
                url: videoUrl,
                responseType: 'blob',
                onload: function (response) {
                    const blob = response.response;

                    // For caching, convert blob to data URL
                    const reader = new FileReader();
                    reader.onload = function () {
                        const videoDataUrl = reader.result;
                        const cacheObject = {
                            timestamp: Date.now(),
                            data: videoDataUrl
                        };
                        GM_setValue(videoUrl, cacheObject);
                    };
                    reader.readAsDataURL(blob);

                    // For playback, create a blob URL and use it
                    const blobUrl = URL.createObjectURL(blob);
                    setVideoSource(blobUrl);
                }
            });
        }
    }

    // Function to set the video source
    function setVideoSource(videoData) {
        const videoElement = document.querySelector('video');
        if (videoElement) {
            videoElement.src = videoData;
        }
    }

    // Wait for the video element to be available
    const observer = new MutationObserver((mutations, obs) => {
        const videoElement = document.querySelector('video.vjs-tech');
        if (videoElement && videoElement.src) {
            const videoUrl = videoElement.src;
            // The src can be a blob if already loaded from cache, so we check if it's a real URL
            if (videoUrl.startsWith('http') || videoUrl.startsWith('//')) {
                getAndCacheVideo(videoUrl);
            }
            obs.disconnect(); // Stop observing once we have the URL
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
})();