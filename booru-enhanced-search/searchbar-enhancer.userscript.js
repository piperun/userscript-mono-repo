// ==UserScript==
// @name         Booru Search Tag Enhancer (Universal)
// @namespace    http://tampermonkey.net/
// @version      1.9
// @description  Modernize and enhance search bar and tag input for booru sites, with site-specific styles, auto-contrast, and improved layout for rule34.xxx and e621.net
// @author       You
// @match        *://*.booru.org/*
// @match        *://*.booru.com/*
// @match        *://*.booru.ca/*
// @match        *://*.booru.xxx/*
// @match        *://rule34.xxx/*
// @match        *://safebooru.org/*
// @match        *://danbooru.donmai.us/*
// @match        *://e621.net/*
// @grant        none
// ==/UserScript==

// --- Awesomplete hijack: always attach instance to input ---
(function() {
    const origAwesomplete = window.Awesomplete;
    if (typeof origAwesomplete === "function") {
        window.Awesomplete = function AwesompleteHijack(input, options) {
            const instance = new origAwesomplete(input, options);
            input.awesomplete = instance;
            return instance;
        };
        // Copy prototype and static properties
        Object.setPrototypeOf(window.Awesomplete, origAwesomplete);
        window.Awesomplete.prototype = origAwesomplete.prototype;
    }
})();

(function() {
    'use strict';

    let tags = [];
    let isE621 = location.hostname.endsWith('e621.net');
    let isRule34 = location.hostname.endsWith('rule34.xxx');

    // Helper: get contrast color (YIQ)
    function getContrastYIQ(hexcolor) {
        hexcolor = hexcolor.replace('#', '').trim();
        // If rgb/rgba, convert to hex
        if (hexcolor.startsWith('rgb')) {
            const rgb = hexcolor.match(/\d+/g).map(Number);
            if (rgb.length >= 3) {
                hexcolor = rgb.slice(0,3).map(x => x.toString(16).padStart(2, '0')).join('');
            }
        }
        if (hexcolor.length === 3) {
            hexcolor = hexcolor.split('').map(x => x + x).join('');
        }
        if (hexcolor.length !== 6) return '#222';
        var r = parseInt(hexcolor.substr(0,2),16);
        var g = parseInt(hexcolor.substr(2,2),16);
        var b = parseInt(hexcolor.substr(4,2),16);
        var yiq = ((r*299)+(g*587)+(b*114))/1000;
        return (yiq >= 128) ? '#222' : '#fff';
    }

    // Update tag colors based on site and theme
    function updateTagColors() {
        let bg, border;
        if (isE621) {
            const root = document.body;
            bg = getComputedStyle(root).getPropertyValue('--color-tag-general') || '#e6f7ff';
            border = getComputedStyle(root).getPropertyValue('--color-tag-general-alt') || '#7ecfff';
        } else if (isRule34) {
            bg = '#e6ffe6';
            border = '#7edc7e';
        } else {
            bg = '#e0ffe0';
            border = '#b0d0b0';
        }
        document.querySelectorAll('.r34-tag-item').forEach(tag => {
            tag.style.background = bg.trim();
            tag.style.borderColor = border.trim();
            // Auto-contrast text color
            let color = getContrastYIQ(bg.trim());
            tag.style.color = color;
        });
    }

    // Render tags
    function renderTags(tagList) {
        tagList.innerHTML = '';
        tags.forEach((tag, idx) => {
            const tagEl = document.createElement('span');
            tagEl.className = 'r34-tag-item';
            tagEl.textContent = tag;
            const removeBtn = document.createElement('span');
            removeBtn.className = 'r34-remove-tag';
            removeBtn.textContent = '×';
            removeBtn.onclick = () => {
                tags.splice(idx, 1);
                renderTags(tagList);
            };
            tagEl.appendChild(removeBtn);
            tagList.appendChild(tagEl);
        });
        updateTagColors();
    }

    // Helper: get tags from URL
    function getTagsFromURL() {
        const params = new URLSearchParams(window.location.search);
        let tagString = params.get('tags') || '';
        // Replace + with space, then split by space, filter out empty
        return tagString.replace(/\+/g, ' ').split(/\s+/).filter(Boolean);
    }

    // Create the search section structure
    function createSearchSection(site) {
        const centerWrap = document.createElement('div');
        centerWrap.className = 'r34-center-wrap';

        const searchForm = document.createElement('form');
        searchForm.className = 'r34-search-form';
        searchForm.method = 'GET';
        searchForm.action = '';

        const searchBarContainer = document.createElement('div');
        searchBarContainer.className = 'r34-modern-searchbar';

        let searchInput;
        if (site === 'e621') {
            searchInput = document.createElement('textarea');
            searchInput.rows = 1;
            searchInput.id = 'tags';
            searchInput.setAttribute('data-autocomplete', 'tag-query');
            searchInput.placeholder = 'Enter tags...';
            searchInput.className = 'r34-search-input';
        } else {
            searchInput = document.createElement('input');
            searchInput.type = 'text';
            searchInput.name = 'tags';
            searchInput.placeholder = 'Enter tags...';
            searchInput.className = 'r34-search-input';
        }

        const searchButton = document.createElement('button');
        searchButton.type = 'submit';
        searchButton.textContent = 'Search';
        searchButton.className = 'r34-search-button';

        const tagList = document.createElement('div');
        tagList.className = 'r34-tag-list';

        // Track if user is navigating autocomplete with arrow keys
        let autocompleteNavigating = false;

        searchInput.addEventListener('keydown', function(e) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                autocompleteNavigating = true;
            }
        });
        searchInput.addEventListener('input', function(e) {
            autocompleteNavigating = false;
            // Existing separator logic
            let value = searchInput.value;
            if (/[,\s]$/.test(value)) {
                value = value.replace(/[,\s]+$/, '').trim();
                if (value && !tags.includes(value)) {
                    tags.push(value);
                    renderTags(tagList);
                }
                searchInput.value = '';
            }
        });

        // Add plus button for manual tag add
        const plusBtn = document.createElement('button');
        plusBtn.type = 'button';
        plusBtn.textContent = '+';
        plusBtn.className = 'r34-add-tag-btn';
        plusBtn.title = 'Add tag';
        plusBtn.style.marginLeft = '6px';
        plusBtn.onclick = function() {
            const value = searchInput.value.trim();
            if (value && !tags.includes(value)) {
                tags.push(value);
                renderTags(tagList);
            }
            searchInput.value = '';
            searchInput.focus();
            autocompleteNavigating = false;
        };
        // Safe insert: only insertBefore if searchButton is a child
        if (searchButton.parentNode === searchBarContainer) {
            searchBarContainer.insertBefore(plusBtn, searchButton);
        } else {
            searchBarContainer.appendChild(plusBtn);
        }

        // Only submit form on Enter if input is empty and there are tags
        searchInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                if (autocompleteNavigating) {
                    // Let autocomplete handle Enter
                    return;
                }
                // If input is empty and there are tags, submit
                if (searchInput.value.trim() === '' && tags.length > 0) {
                    e.preventDefault();
                    searchInput.value = tags.join(' ');
                    searchForm.submit();
                } else if (searchInput.value.trim() !== '') {
                    // No suggestion selected, add raw input as tag
                    e.preventDefault();
                    const value = searchInput.value.trim();
                    if (value && !tags.includes(value)) {
                        tags.push(value);
                        renderTags(tagList);
                    }
                    searchInput.value = '';
                    autocompleteNavigating = false;
                    // Close/hide autocomplete dropdown
                    if (site === 'rule34' && searchInput.awesomplete) {
                        searchInput.awesomplete.close();
                    }
                    if (site === 'e621') {
                        const ul = document.querySelector('ul[role="listbox"]');
                        if (ul) ul.setAttribute('hidden', '');
                    }
                }
            }
        });

        searchForm.addEventListener('submit', function(e) {
            if (tags.length > 0) {
                searchInput.value = tags.join(' ');
            }
        });

        // Assemble the structure
        searchBarContainer.appendChild(searchInput);
        searchBarContainer.appendChild(searchButton);
        searchForm.appendChild(searchBarContainer);
        centerWrap.appendChild(searchForm);
        centerWrap.appendChild(tagList);

        // Add event listeners
        // --- Awesomplete integration for rule34 ---
        if (site === 'rule34') {
            searchInput.addEventListener('awesomplete-selectcomplete', function(e) {
                const value = searchInput.value.trim();
                if (value && !tags.includes(value)) {
                    tags.push(value);
                    renderTags(tagList);
                }
                searchInput.value = '';
            });
        }

        return { centerWrap, searchForm, searchInput, searchButton, tagList };
    }

    // e621.net specific implementation
    function setupE621() {
        const originalForm = document.querySelector('form.post-search-form');
        const gallery = document.querySelector('#c-posts');
        
        if (!originalForm || !gallery) return;

        // Get the original form's action and method
        const formAction = originalForm.action;
        const formMethod = originalForm.method;

        // Create our search section
        const { centerWrap, searchForm, searchInput, searchButton, tagList } = createSearchSection('e621');
        
        // Set the form properties
        searchForm.action = formAction;
        searchForm.method = formMethod;

        // Insert before gallery
        gallery.parentNode.insertBefore(centerWrap, gallery);

        // Hide the original form
        originalForm.style.display = 'none';

        // Initialize tags from URL
        tags = getTagsFromURL();
        renderTags(tagList);
        searchInput.value = '';

        // Set up theme observer
        const observer = new MutationObserver(updateTagColors);
        observer.observe(document.body, { attributes: true, attributeFilter: ['data-th-main'] });
    }

    // rule34.xxx specific implementation
    function setupRule34() {
        const originalForm = document.querySelector('.sidebar .tag-search form');
        const gallery = document.querySelector('#post-list');
        
        if (!originalForm || !gallery) return;

        // Get the original form's action and method
        const formAction = originalForm.action;
        const formMethod = originalForm.method;

        // Create our search section
        const { centerWrap, searchForm, searchInput, searchButton, tagList } = createSearchSection('rule34');
        
        // Set the form properties
        searchForm.action = formAction;
        searchForm.method = formMethod;

        // Insert before gallery
        gallery.parentNode.insertBefore(centerWrap, gallery);

        // Hide the original form
        originalForm.style.display = 'none';

        // Initialize tags from URL
        tags = getTagsFromURL();
        renderTags(tagList);
        searchInput.value = '';
    }

    // Generic implementation for other boorus
    function setupGeneric() {
        const originalForm = findSearchForm();
        if (!originalForm) return;

        const searchField = originalForm.querySelector('input[name="tags"], textarea[name="tags"]');
        if (!searchField) return;

        // Create tag list
        const tagList = document.createElement('div');
        tagList.className = 'r34-tag-list';
        searchField.insertAdjacentElement('afterend', tagList);

        // Initialize tags from URL
        tags = getTagsFromURL();
        renderTags(tagList);
        searchField.value = '';

        // Add event listeners to original field
        searchField.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                const value = searchField.value.trim();
                if (value) {
                    e.preventDefault();
                    if (!tags.includes(value)) {
                        tags.push(value);
                        renderTags(tagList);
                    }
                    searchField.value = '';
                } else if (tags.length > 0) {
                    e.preventDefault();
                    searchField.value = tags.join(' ');
                    originalForm.submit();
                }
            }
        });

        originalForm.addEventListener('submit', function(e) {
            if (tags.length > 0) {
                searchField.value = tags.join(' ');
            }
        });
    }

    function findSearchForm() {
        let form = document.querySelector('.sidebar form input[name="tags"], .sidebar form textarea[name="tags"]');
        if (form) return form.closest('form');
        form = document.querySelector('form input[name="tags"], form textarea[name="tags"]');
        return form ? form.closest('form') : null;
    }

    // Add styles
    const style = document.createElement('style');
    style.textContent = `
        .r34-center-wrap {
            display: flex;
            flex-direction: column;
            align-items: center;
            width: 100%;
            margin-bottom: 20px;
        }
        .r34-search-form {
            width: 90vw;
            max-width: 700px;
            min-width: 220px;
            margin: 0 auto;
        }
        .r34-modern-searchbar {
            display: flex;
            flex-direction: row;
            align-items: center;
            gap: 16px;
            width: 100%;
            margin-bottom: 10px;
            justify-content: center;
        }
        /* Only for rule34: input and button are right next to each other, responsive */
        body#body .r34-search-form, body#body .r34-modern-searchbar {
            width: 90vw;
            max-width: 500px;
            min-width: 220px;
            margin: 0 auto;
            justify-content: center;
        }
        @media (max-width: 600px) {
            body#body .r34-search-form, body#body .r34-modern-searchbar {
                max-width: 100vw;
                width: 100vw;
            }
        }
        body#body .r34-modern-searchbar {
            gap: 12px;
        }
        /* Fix Awesomplete width/flex for userscript searchbar only on rule34 */
        body#body .r34-modern-searchbar .awesomplete {
            display: inline-block !important;
            width: auto !important;
        }
        .r34-search-input {
            flex: 1 1 0%;
            min-width: 0;
            border-radius: 18px;
            padding: 8px 16px;
            font-size: 1.1em;
            border: 2px solid #b0d0b0;
            box-shadow: 0 2px 8px 0 rgba(0,0,0,0.06);
            transition: border-color 0.2s;
            box-sizing: border-box;
            width: 90vw;
            max-width: 500px;
        }
        .r34-search-input:focus {
            border-color: #4a90e2;
            outline: none;
        }
        .r34-search-button {
            border-radius: 18px;
            padding: 8px 28px;
            font-size: 1.1em;
            border: 2px solid #b0d0b0;
            background: #f8fff8;
            cursor: pointer;
            transition: border-color 0.2s, background 0.2s;
            white-space: nowrap;
            flex-shrink: 0;
        }
        .r34-search-button:hover {
            border-color: #4a90e2;
            background: #e0f7fa;
        }
        .r34-tag-list {
            margin: 18px 0 0 0;
            padding: 0;
            display: flex;
            flex-direction: row;
            flex-wrap: wrap;
            gap: 10px;
            max-width: 1000px;
            justify-content: flex-start;
        }
        .r34-tag-item {
            background: #e0ffe0;
            border: 1.5px solid #b0d0b0;
            border-radius: 18px;
            padding: 4px 18px;
            display: flex;
            align-items: center;
            font-size: 1.08em;
            color: #222;
            font-weight: 500;
            transition: background 0.2s, color 0.2s, border-color 0.2s;
        }
        .r34-tag-item .r34-remove-tag {
            margin-left: 12px;
            cursor: pointer;
            color: #c00;
            font-weight: bold;
            font-size: 1.1em;
        }
        /* e621.net coloring */
        body.c-posts.a-index.resp .r34-tag-item {
            background: var(--color-tag-general, #e6f7ff);
            border-color: var(--color-tag-general-alt, #7ecfff);
        }
        /* rule34.xxx coloring */
        body#body .r34-tag-item {
            background: #e6ffe6;
            border-color: #7edc7e;
        }
        @media (max-width: 600px) {
            body#body .r34-search-input {
                width: 100vw;
                max-width: 100vw;
            }
        }
    `;
    document.head.appendChild(style);

    // Initialize based on site
    if (isE621) {
        setupE621();
    } else if (isRule34) {
        setupRule34();
    } else {
        setupGeneric();
    }

    // --- e621 Autocomplete hijack: expose jQuery UI Autocomplete instance ---
    if (location.hostname.endsWith('e621.net')) {
        function exposeE621Autocomplete() {
            var searchInput = document.querySelector('[data-autocomplete="tag-query"], [data-autocomplete="tag-edit"], [data-autocomplete="tag"]');
            if (!searchInput) return;
            var $input = window.jQuery && window.jQuery(searchInput);
            if ($input && $input.autocomplete) {
                var instance = $input.autocomplete("instance");
                if (instance) {
                    searchInput.e621Autocomplete = instance;
                }
            }
        }
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function() {
                exposeE621Autocomplete();
                setTimeout(exposeE621Autocomplete, 1000);
            });
        } else {
            exposeE621Autocomplete();
            setTimeout(exposeE621Autocomplete, 1000);
        }
    }
})(); 