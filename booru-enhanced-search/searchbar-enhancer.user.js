// ==UserScript==
// @name         Booru Search Tag Enhancer (Universal)
// @namespace    http://tampermonkey.net/
// @version      1.9
// @description  Modernize and enhance search bar and tag input for booru sites, with site-specific styles, auto-contrast, and improved layout for rule34.xxx and e621.net
// @author       Piperun
// @license      LGPL-3.0-or-later
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
(function hijackAwesomplete() {
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

(function main() {
    'use strict';

    // --- State ---
    let tags = [];
    const isE621 = location.hostname.endsWith('e621.net');
    const isRule34 = location.hostname.endsWith('rule34.xxx');

    // --- Cheat Sheet Content ---
    const CHEAT_SHEET = `
tag1 tag2
    Search for posts that have tag1 and tag2.
( tag1 ~ tag2 )
    Search for posts that have tag1 or tag2. The braces are important to group the tags between which the "or" counts. The spaces between the braces and tags are also important because some tags end in braces!
night~
    Fuzzy search for the tag night. This will return results such as night fight bright and so on according to the Levenshtein distance.
-tag1
    Search for posts that don't have tag1.
ta*1
    Search for posts with tags that starts with ta and ends with 1.
user:bob
    Search for posts uploaded by the user Bob.
md5:foo
    Search for posts with the MD5 hash foo.
md5:foo*
    Search for posts whose MD5 starts with the MD5 hash foo. 
rating:questionable
    Search for posts that are rated questionable.
-rating:questionable
    Search for posts that are not rated questionable.
parent:1234
    Search for posts that have 1234 as a parent (and include post 1234).
rating:questionable rating:safe
    In general, combining the same metatags (the ones that have colons in them) will not work.
rating:questionable parent:100
    You can combine different metatags, however.
width:>=1000 height:>1000
    Find images with a width greater than or equal to 1000 and a height greater than 1000.
score:>=10
    Find images with a score greater than or equal to 10. This value is updated once daily at 12AM CST.
sort:updated:desc
    Sort posts by their most recently updated order.

    Other sortable types:

        id
        score
        rating
        user
        height
        width
        parent
        source
        updated 

    Can be sorted by both asc or desc. 
`;

    // --- Color/Theme Helpers ---
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

    // --- Tag Management ---
    function addTag(tag) {
        if (!tag || tags.includes(tag)) return;
        tags.push(tag);
        tags = Array.from(new Set(tags));
        renderTags(window.r34_tagList);
    }

    function getTagsFromURL() {
        const params = new URLSearchParams(window.location.search);
        let tagString = params.get('tags') || '';
        // Replace + with space
        tagString = tagString.replace(/\+/g, ' ');
        // Custom split: treat parenthesized groups and tags with parentheses as single tags
        const tags = [];
        let buffer = '';
        let parenLevel = 0;
        let inTag = false;
        for (let i = 0; i < tagString.length; ++i) {
            const c = tagString[i];
            if (c === '(' && !inTag) {
                if (parenLevel === 0 && buffer.trim()) {
                    tags.push(buffer.trim());
                    buffer = '';
                }
                parenLevel++;
                buffer += c;
            } else if (c === ')' && parenLevel > 0) {
                buffer += c;
                parenLevel--;
                if (parenLevel === 0) {
                    tags.push(buffer.trim());
                    buffer = '';
                }
            } else if (c === ' ' && parenLevel === 0) {
                if (buffer.trim()) {
                    tags.push(buffer.trim());
                    buffer = '';
                }
            } else {
                buffer += c;
            }
        }
        if (buffer.trim()) tags.push(buffer.trim());
        return tags.filter(Boolean);
    }

    function renderTags(tagList) {
        // Always get from window to avoid ReferenceError
        const metatagList = window.r34_metatagList;
        const metatagRowWrap = window.r34_metatagRowWrap;
        const includeList = window.r34_includeList;
        const excludeList = window.r34_excludeList;
        // Defensive: ensure tags are unique before rendering
        const uniqueTags = Array.from(new Set(tags));
        // Declare metatagRegex only once
        const metatagRegex = /^(sort:|rating:|user:|parent:|score:|md5:|width:|height:|source:|\( rating:)/;
        // --- Render include/exclude rows ---
        if (includeList) includeList.innerHTML = '';
        if (excludeList) excludeList.innerHTML = '';
        uniqueTags.forEach((tag, idx) => {
            if (metatagRegex.test(tag)) return; // skip metatags
            if (tag.startsWith('-')) {
                // Exclude tag
                if (excludeList) {
                    const tagEl = document.createElement('span');
                    tagEl.className = 'r34-tag-item r34-exclude-item';
                    tagEl.textContent = tag;
                    const removeBtn = document.createElement('span');
                    removeBtn.className = 'r34-remove-tag';
                    removeBtn.textContent = '×';
                    removeBtn.onclick = () => {
                        const tagIdx = tags.indexOf(tag);
                        if (tagIdx !== -1) {
                            tags.splice(tagIdx, 1);
                            renderTags(tagList);
                        }
                    };
                    tagEl.appendChild(removeBtn);
                    excludeList.appendChild(tagEl);
                }
            } else {
                // Include tag
                if (includeList) {
                    const tagEl = document.createElement('span');
                    tagEl.className = 'r34-tag-item r34-include-item';
                    tagEl.textContent = tag;
                    const removeBtn = document.createElement('span');
                    removeBtn.className = 'r34-remove-tag';
                    removeBtn.textContent = '×';
                    removeBtn.onclick = () => {
                        const tagIdx = tags.indexOf(tag);
                        if (tagIdx !== -1) {
                            tags.splice(tagIdx, 1);
                            renderTags(tagList);
                        }
                    };
                    tagEl.appendChild(removeBtn);
                    includeList.appendChild(tagEl);
                }
            }
        });
        // --- Render metatag row ---
        if (metatagList && metatagRowWrap) {
            metatagList.innerHTML = '';
            const metatags = uniqueTags.filter(tag => metatagRegex.test(tag));
            if (metatags.length > 0) {
                metatagRowWrap.style.display = '';
                metatags.forEach((tag, idx) => {
                    const tagEl = document.createElement('span');
                    tagEl.className = 'r34-tag-item r34-metatag-item';
                    tagEl.textContent = tag;
                    const removeBtn = document.createElement('span');
                    removeBtn.className = 'r34-remove-tag';
                    removeBtn.textContent = '×';
                    removeBtn.onclick = () => {
                        // Remove from tags and update UI controls as before
                        const tagIdx = tags.indexOf(tag);
                        if (tagIdx !== -1) {
                            tags.splice(tagIdx, 1);
                            renderTags(tagList);
                        }
                    };
                    tagEl.appendChild(removeBtn);
                    metatagList.appendChild(tagEl);
                });
            } else {
                metatagRowWrap.style.display = 'none';
            }
        }
        // --- Bi-directional sync: update UI controls from metatags ---
        // Find sort and rating metatags
        let sortType = '';
        let sortOrder = 'desc';
        let foundSort = false;
        let ratingsSet = new Set();
        uniqueTags.forEach(tag => {
            // sort:<type>:<order>
            const sortMatch = tag.match(/^sort:([a-z_]+):(asc|desc)$/);
            if (sortMatch) {
                sortType = sortMatch[1];
                sortOrder = sortMatch[2];
                foundSort = true;
            }
            // rating:<value>
            const ratingMatch = tag.match(/^rating:(safe|questionable|explicit)$/);
            if (ratingMatch) {
                ratingsSet.add(ratingMatch[1]);
            }
            // ( rating:type ~ rating:type )
            const ratingOrMatch = tag.match(/^\(\s*([^)]+)\s*\)$/);
            if (ratingOrMatch) {
                // Split by ~ and extract rating values
                const parts = ratingOrMatch[1].split('~').map(s => s.trim());
                parts.forEach(part => {
                    const m = part.match(/^rating:(safe|questionable|explicit)$/);
                    if (m) ratingsSet.add(m[1]);
                });
            }
        });
        // Update sort dropdown
        if (typeof sortSelect !== 'undefined') {
            sortSelect.value = foundSort ? sortType : '';
            // Show/hide order switch
            if (foundSort) {
                orderSwitch.style.display = '';
                orderSwitch.dataset.state = sortOrder;
                orderSwitch.textContent = sortOrder === 'asc' ? 'Order: Ascend \u2191' : 'Order: Descend \u2193';
            } else {
                orderSwitch.style.display = 'none';
            }
        }
        // Update rating checkboxes
        if (typeof sortRow !== 'undefined') {
            sortRow.querySelectorAll('.r34-rating-checkbox').forEach(cb => {
                cb.checked = ratingsSet.has(cb.value);
            });
        }
        // --- Render only non-metatag tag pills in the main tag list ---
        tagList.innerHTML = '';
        uniqueTags.forEach((tag, idx) => {
            if (metatagRegex.test(tag)) return; // skip metatags in main tag list
            const tagEl = document.createElement('span');
            tagEl.className = 'r34-tag-item';
            tagEl.textContent = tag;
            const removeBtn = document.createElement('span');
            removeBtn.className = 'r34-remove-tag';
            removeBtn.textContent = '×';
            removeBtn.onclick = () => {
                // --- Bi-directional sync: update UI controls when metatag pill is removed ---
                // If removing a sort or rating metatag, update UI controls
                if (/^sort:[a-z_]+:(asc|desc)$/.test(tag)) {
                    if (typeof sortSelect !== 'undefined') {
                        sortSelect.value = '';
                        orderSwitch.style.display = 'none';
                    }
                }
                if (/^rating:(safe|questionable|explicit)$/.test(tag)) {
                    if (typeof sortRow !== 'undefined') {
                        sortRow.querySelectorAll('.r34-rating-checkbox').forEach(cb => {
                            if (cb.value === tag.split(':')[1]) cb.checked = false;
                        });
                    }
                }
                const tagIdx = tags.indexOf(tag);
                if (tagIdx !== -1) {
                    tags.splice(tagIdx, 1);
                renderTags(tagList);
                }
            };
            tagEl.appendChild(removeBtn);
            tagList.appendChild(tagEl);
        });
        updateTagColors();
    }

    // --- Modal Creation ---
    function createModal(id, title, contentNode, actions) {
        // Remove any existing modal with this id
        const old = document.getElementById(id);
        if (old) old.remove();
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.id = id;
        modal.tabIndex = -1;
        modal.style.display = 'none';

        // Modal overlay
        const modalContent = document.createElement('div');
        modalContent.className = 'modal-content';

        // Close (×) button
        const closeX = document.createElement('button');
        closeX.className = 'modal-close';
        closeX.type = 'button';
        closeX.innerHTML = '&times;';
        closeX.title = 'Close';
        closeX.onclick = () => { modal.style.display = 'none'; };
        modalContent.appendChild(closeX);

        // Title
        const h3 = document.createElement('h3');
        h3.textContent = title;
        modalContent.appendChild(h3);

        modalContent.appendChild(contentNode);
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'modal-actions';
        actions.forEach(btn => actionsDiv.appendChild(btn));
        modalContent.appendChild(actionsDiv);
        modal.appendChild(modalContent);
        document.body.appendChild(modal);
        // Modal close on Esc/click outside
        function closeModal() { modal.style.display = 'none'; }
        modal.addEventListener('mousedown', e => { if (e.target === modal) closeModal(); });
        modal.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
        return { modal, closeModal };
    }

    // --- Export Modal ---
    function showExportModal() {
        // --- Export Data Preparation ---
        const website = location.hostname;
        const timestamp = new Date().toISOString();
        const rawTags = tags.join(' ');
        const jsonExport = JSON.stringify({ website, tags: [...tags], timestamp }, null, 2);

        // --- Modal Elements ---
        const tabWrap = document.createElement('div');
        tabWrap.className = 'modal-tabs';
        const rawTab = document.createElement('button');
        rawTab.textContent = 'Raw';
        rawTab.type = 'button';
        rawTab.className = 'modal-tab';
        const jsonTab = document.createElement('button');
        jsonTab.textContent = 'JSON';
        jsonTab.type = 'button';
        jsonTab.className = 'modal-tab';
        tabWrap.appendChild(rawTab);
        tabWrap.appendChild(jsonTab);

        const textarea = document.createElement('textarea');
        textarea.readOnly = true;
        textarea.className = 'modal-pastebin';
        textarea.value = rawTags;

        // --- Action Buttons ---
        const copyBtn = document.createElement('button');
        copyBtn.textContent = 'Copy';
        copyBtn.type = 'button';
        copyBtn.onclick = function() {
            textarea.select();
            document.execCommand('copy');
        };

        const exportBtn = document.createElement('button');
        exportBtn.textContent = 'Export to file';
        exportBtn.type = 'button';
        exportBtn.style.display = 'none';
        exportBtn.onclick = function() {
            const blob = new Blob([jsonExport], {type: 'application/json'});
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'booru-tags.json';
            document.body.appendChild(a);
            a.click();
            setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
        };

        const closeBtn = document.createElement('button');
        closeBtn.textContent = 'Close';
        closeBtn.type = 'button';

        // --- Tab Switch Logic ---
        function showRaw() {
            textarea.value = rawTags;
            copyBtn.style.display = '';
            exportBtn.style.display = 'none';
            rawTab.classList.add('active');
            jsonTab.classList.remove('active');
        }
        function showJSON() {
            textarea.value = jsonExport;
            copyBtn.style.display = 'none';
            exportBtn.style.display = '';
            rawTab.classList.remove('active');
            jsonTab.classList.add('active');
        }
        rawTab.onclick = showRaw;
        jsonTab.onclick = showJSON;

        // --- Modal Content (Refactored) ---
        const formWrap = document.createElement('div');
        formWrap.className = 'modal-form';
        formWrap.appendChild(tabWrap);
        formWrap.appendChild(textarea);
        // The modal-actions div is handled by createModal, so do not add buttons here

        // --- Modal Actions ---
        const actions = [copyBtn, exportBtn, closeBtn];

        let modalObj = createModal('modal-export', 'Export Tags', formWrap, actions);
        closeBtn.onclick = modalObj.closeModal;
        modalObj.modal.style.display = 'flex';
        modalObj.modal.focus();
        // Default to raw view
        showRaw();
    }

    // --- Cheat Sheet Modal ---
    function showCheatSheetModal() {
        // Structured documentation-style cheat sheet
        const docWrap = document.createElement('div');
        docWrap.className = 'modal-doc';
        docWrap.innerHTML = `
          <section><h4>Basic Search</h4>
            <ul>
              <li><code>tag1 tag2</code> — Posts with <b>tag1</b> and <b>tag2</b></li>
              <li><code>( tag1 ~ tag2 )</code> — Posts with <b>tag1</b> or <b>tag2</b></li>
              <li><code>night~</code> — Fuzzy search for <b>night</b> (e.g. <b>night</b>, <b>fight</b>, <b>bright</b>)</li>
              <li><code>-tag1</code> — Exclude posts with <b>tag1</b></li>
              <li><code>ta*1</code> — Tags starting with <b>ta</b> and ending with <b>1</b></li>
            </ul>
          </section>
          <section><h4>Metatags</h4>
            <ul>
              <li><code>user:bob</code> — Uploaded by user <b>bob</b></li>
              <li><code>md5:foo</code> — Posts with MD5 <b>foo</b></li>
              <li><code>md5:foo*</code> — MD5 starts with <b>foo</b></li>
              <li><code>rating:questionable</code> — Rated <b>questionable</b></li>
              <li><code>-rating:questionable</code> — Not rated <b>questionable</b></li>
              <li><code>parent:1234</code> — Has parent <b>1234</b> (includes 1234)</li>
              <li><code>width:>=1000 height:>1000</code> — Width ≥ 1000, Height > 1000</li>
              <li><code>score:>=10</code> — Score ≥ 10</li>
            </ul>
          </section>
          <section><h4>Sorting</h4>
            <ul>
              <li><code>sort:updated:desc</code> — Sort by <b>updated</b> (descending)</li>
              <li>Other sortable types: <code>id</code>, <code>score</code>, <code>rating</code>, <code>user</code>, <code>height</code>, <code>width</code>, <code>parent</code>, <code>source</code>, <code>updated</code></li>
              <li>Can be sorted by both <b>asc</b> or <b>desc</b></li>
            </ul>
          </section>
          <section><h4>Notes</h4>
            <ul>
              <li>Combining the same metatags (with colons) usually does not work.</li>
              <li>You can combine different metatags (e.g. <code>rating:questionable parent:100</code>).</li>
            </ul>
          </section>
        `;
        const closeBtn = document.createElement('button');
        closeBtn.textContent = 'Close';
        closeBtn.type = 'button';
        let modalObj = createModal('modal-cheat', 'Cheat Sheet', docWrap, [closeBtn]);
        closeBtn.onclick = modalObj.closeModal;
        modalObj.modal.style.display = 'flex';
        modalObj.modal.focus();
    }

    // --- Search Bar Creation ---
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

        // --- Searchbar Buttons ---
        const exportBtn = document.createElement('button');
        exportBtn.type = 'button';
        exportBtn.textContent = 'Export';
        exportBtn.className = 'r34-export-btn';
        exportBtn.title = 'Export tags';
        exportBtn.onclick = showExportModal;

        const cheatBtn = document.createElement('button');
        cheatBtn.type = 'button';
        cheatBtn.textContent = '?';
        cheatBtn.className = 'r34-cheat-btn';
        cheatBtn.title = 'Show cheat sheet';
        cheatBtn.onclick = showCheatSheetModal;

        const searchButton = document.createElement('button');
        searchButton.type = 'submit';
        searchButton.textContent = 'Search';
        searchButton.className = 'r34-search-button';

        // --- New Sort/Order/Ratings Row ---
        const sortRow = document.createElement('div');
        sortRow.className = 'r34-sort-row';
        // Sort dropdown
        const sortSelect = document.createElement('select');
        sortSelect.className = 'r34-sort-select';
        const emptyOption = document.createElement('option');
        emptyOption.value = '';
        emptyOption.textContent = 'Sort';
        sortSelect.appendChild(emptyOption);
        // Example sort options (add more as needed)
        const sortOptions = [
            { value: 'score', label: 'Score' },
            { value: 'updated', label: 'Updated' },
            { value: 'id', label: 'ID' },
            { value: 'rating', label: 'Rating' },
            { value: 'user', label: 'User' },
            { value: 'height', label: 'Height' },
            { value: 'width', label: 'Width' },
            { value: 'parent', label: 'Parent' },
            { value: 'source', label: 'Source' }
        ];
        sortOptions.forEach(opt => {
            const option = document.createElement('option');
            option.value = opt.value;
            option.textContent = opt.label;
            sortSelect.appendChild(option);
        });
        sortRow.appendChild(sortSelect);
        // Order switch
        const orderSwitch = document.createElement('button');
        orderSwitch.type = 'button';
        orderSwitch.className = 'r34-order-switch';
        orderSwitch.dataset.state = 'desc'; // default to desc
        orderSwitch.textContent = 'Order: Descend \u2193';
        orderSwitch.style.display = 'none'; // hidden by default
        orderSwitch.onclick = function() {
            // Cycle through: desc -> asc -> desc
            const state = orderSwitch.dataset.state;
            if (state === 'desc') {
                orderSwitch.dataset.state = 'asc';
                orderSwitch.textContent = 'Order: Ascend \u2191';
            } else {
                orderSwitch.dataset.state = 'desc';
                orderSwitch.textContent = 'Order: Descend \u2193';
            }
        };
        sortRow.appendChild(orderSwitch);
        // Show/hide order switch based on sort selection
        sortSelect.addEventListener('change', function() {
            if (sortSelect.value) {
                orderSwitch.style.display = '';
            } else {
                orderSwitch.style.display = 'none';
            }
        });
        // Ratings checkboxes
        const ratings = [
            { value: 'safe', label: 'Safe' },
            { value: 'questionable', label: 'Questionable' },
            { value: 'explicit', label: 'Explicit' }
        ];
        ratings.forEach(r => {
            const label = document.createElement('label');
            label.className = 'r34-rating-label';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = r.value;
            checkbox.className = 'r34-rating-checkbox';
            label.appendChild(checkbox);
            label.appendChild(document.createTextNode(' ' + r.label));
            sortRow.appendChild(label);
        });

        const tagList = document.createElement('div');
        tagList.className = 'r34-tag-list';

        // --- Include/Exclude Tag Rows ---
        // Include row
        const includeRowWrap = document.createElement('div');
        includeRowWrap.className = 'r34-include-row-wrap';
        const includeRowHeader = document.createElement('div');
        includeRowHeader.className = 'r34-include-row-header';
        const includeRowTitle = document.createElement('span');
        includeRowTitle.textContent = 'Include Tags';
        const includeToggle = document.createElement('button');
        includeToggle.type = 'button';
        includeToggle.className = 'r34-include-toggle';
        includeToggle.textContent = 'See less';
        includeRowHeader.appendChild(includeRowTitle);
        includeRowHeader.appendChild(includeToggle);
        const includeList = document.createElement('div');
        includeList.className = 'r34-include-list';
        includeRowWrap.appendChild(includeRowHeader);
        includeRowWrap.appendChild(includeList);
        let includeExpanded = true;
        includeList.style.display = '';
        includeToggle.onclick = function() {
            includeExpanded = !includeExpanded;
            includeList.style.display = includeExpanded ? '' : 'none';
            includeToggle.textContent = includeExpanded ? 'See less' : 'See more';
        };
        // Exclude row
        const excludeRowWrap = document.createElement('div');
        excludeRowWrap.className = 'r34-exclude-row-wrap';
        const excludeRowHeader = document.createElement('div');
        excludeRowHeader.className = 'r34-exclude-row-header';
        const excludeRowTitle = document.createElement('span');
        excludeRowTitle.textContent = 'Exclude Tags';
        const excludeToggle = document.createElement('button');
        excludeToggle.type = 'button';
        excludeToggle.className = 'r34-exclude-toggle';
        excludeToggle.textContent = 'See less';
        excludeRowHeader.appendChild(excludeRowTitle);
        excludeRowHeader.appendChild(excludeToggle);
        const excludeList = document.createElement('div');
        excludeList.className = 'r34-exclude-list';
        excludeRowWrap.appendChild(excludeRowHeader);
        excludeRowWrap.appendChild(excludeList);
        let excludeExpanded = true;
        excludeList.style.display = '';
        excludeToggle.onclick = function() {
            excludeExpanded = !excludeExpanded;
            excludeList.style.display = excludeExpanded ? '' : 'none';
            excludeToggle.textContent = excludeExpanded ? 'See less' : 'See more';
        };

        // --- Metatag Row ---
        const metatagRowWrap = document.createElement('div');
        metatagRowWrap.className = 'r34-metatag-row-wrap';
        const metatagRowHeader = document.createElement('div');
        metatagRowHeader.className = 'r34-metatag-row-header';
        const metatagRowTitle = document.createElement('span');
        metatagRowTitle.textContent = 'Metatags';
        const metatagToggle = document.createElement('button');
        metatagToggle.type = 'button';
        metatagToggle.className = 'r34-metatag-toggle';
        metatagToggle.textContent = 'See more';
        metatagRowHeader.appendChild(metatagRowTitle);
        metatagRowHeader.appendChild(metatagToggle);
        const metatagList = document.createElement('div');
        metatagList.className = 'r34-metatag-list';
        metatagRowWrap.appendChild(metatagRowHeader);
        metatagRowWrap.appendChild(metatagList);
        let metatagExpanded = false;
        metatagList.style.display = 'none';
        metatagToggle.onclick = function() {
            metatagExpanded = !metatagExpanded;
            metatagList.style.display = metatagExpanded ? '' : 'none';
            metatagToggle.textContent = metatagExpanded ? 'See less' : 'See more';
        };

        // Track if user is navigating autocomplete with arrow keys
        let autocompleteNavigating = false;

        // --- Event Bindings ---
        function bindInputEvents() {
        searchInput.addEventListener('keydown', function(e) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                autocompleteNavigating = true;
            }
        });
        searchInput.addEventListener('input', function(e) {
            autocompleteNavigating = false;
            let value = searchInput.value;
            // Only split on comma or space if not inside parentheses
            const endsWithSeparator = /[ ,]$/.test(value);
            // Count open/close parentheses
            const openParens = (value.match(/\(/g) || []).length;
            const closeParens = (value.match(/\)/g) || []).length;
            const balanced = openParens === closeParens;
            if (endsWithSeparator && balanced) {
                value = value.replace(/[ ,]+$/, '').trim();
                addTag(value);
                searchInput.value = '';
            }
        });
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
                    addTag(value);
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
        }

        function bindFormEvents() {
        searchForm.addEventListener('submit', function(e) {
            // --- Inject metatags from UI controls ---
            let metatags = [];
            // Sort + Order (single metatag)
            if (sortSelect.value) {
                let order = orderSwitch.dataset.state || 'desc';
                metatags.push(`sort:${sortSelect.value}:${order}`);
            }
            // Ratings (OR logic)
            const checkedRatings = Array.from(sortRow.querySelectorAll('.r34-rating-checkbox:checked')).map(cb => cb.value);
            if (checkedRatings.length === 1) {
                metatags.push(`rating:${checkedRatings[0]}`);
            } else if (checkedRatings.length > 1) {
                metatags.push('( ' + checkedRatings.map(r => `rating:${r}`).join(' ~ ') + ' )');
            }
            // Remove any existing metatags of these types from tags
            const metatagPrefixes = ['sort:', 'rating:','( rating:'];
            tags = tags.filter(tag => !metatagPrefixes.some(prefix => tag.startsWith(prefix)));
            // Add new metatags
            tags = [...tags, ...metatags];
            // Update input value for submission
            if (tags.length > 0) {
                searchInput.value = tags.join(' ');
            }
        });
        }

        // --- Awesomplete integration for rule34 ---
        function bindAwesompleteEvents() {
        if (site === 'rule34') {
            searchInput.addEventListener('awesomplete-selectcomplete', function(e) {
                const value = searchInput.value.trim();
                addTag(value);
                searchInput.value = '';
            });
        }
        }

        // --- Sync metatags with UI changes ---
        function syncMetatagsFromUI() {
            // Remove all sort: and rating: metatags (including parenthesized OR metatags and single rating: ones)
            tags = tags.filter(tag => {
                if (tag.startsWith('sort:')) return false;
                if (/^rating:(safe|questionable|explicit)$/.test(tag)) return false;
                if (/^\(\s*rating:(safe|questionable|explicit)(\s*~\s*rating:(safe|questionable|explicit))*\s*\)$/.test(tag)) return false;
                return true;
            });
            // Add sort metatag if selected
            if (sortSelect.value) {
                let order = orderSwitch.dataset.state || 'desc';
                tags.push(`sort:${sortSelect.value}:${order}`);
            }
            // Add rating metatag(s) with OR logic
            const checkedRatings = Array.from(sortRow.querySelectorAll('.r34-rating-checkbox:checked')).map(cb => cb.value);
            if (checkedRatings.length === 1) {
                tags.push(`rating:${checkedRatings[0]}`);
            } else if (checkedRatings.length > 1) {
                tags.push('( ' + checkedRatings.map(r => `rating:${r}`).join(' ~ ') + ' )');
            }
            tags = Array.from(new Set(tags));
            renderTags(tagList);
        }
        sortSelect.addEventListener('change', syncMetatagsFromUI);
        orderSwitch.addEventListener('click', syncMetatagsFromUI);
        sortRow.querySelectorAll('.r34-rating-checkbox').forEach(cb => {
            cb.addEventListener('change', syncMetatagsFromUI);
        });

        // --- Assemble ---
        searchBarContainer.appendChild(exportBtn);
        searchBarContainer.appendChild(searchInput);
        searchBarContainer.appendChild(cheatBtn);
        searchBarContainer.appendChild(searchButton);
        searchForm.appendChild(searchBarContainer);
        // Insert the new row below the search bar, above the tag list
        searchForm.appendChild(sortRow);
        centerWrap.appendChild(searchForm);
        centerWrap.appendChild(tagList);
        centerWrap.appendChild(includeRowWrap);
        centerWrap.appendChild(excludeRowWrap);
        centerWrap.appendChild(metatagRowWrap);

        // --- Bind Events ---
        bindInputEvents();
        bindFormEvents();
        bindAwesompleteEvents();

        // Make tagList, metatagList and metatagRowWrap globally accessible for addTag/renderTags
        window.r34_tagList = tagList;
        window.r34_includeList = includeList;
        window.r34_excludeList = excludeList;
        window.r34_metatagList = metatagList;
        window.r34_metatagRowWrap = metatagRowWrap;
        return { centerWrap, searchForm, searchInput, searchButton, tagList, includeList, excludeList, metatagList, metatagRowWrap };
    }

    // --- Site-Specific Setup ---
    function setupE621() {
        const originalForm = document.querySelector('form.post-search-form');
        const gallery = document.querySelector('#c-posts');
        if (!originalForm || !gallery) return;
        const formAction = originalForm.action;
        const formMethod = originalForm.method;
        const { centerWrap, searchForm, searchInput, searchButton, tagList, metatagList, metatagRowWrap } = createSearchSection('e621');
        searchForm.action = formAction;
        searchForm.method = formMethod;
        gallery.parentNode.insertBefore(centerWrap, gallery);
        originalForm.style.display = 'none';
        tags = getTagsFromURL();
        renderTags(tagList);
        searchInput.value = '';
        // Set up theme observer
        const observer = new MutationObserver(updateTagColors);
        observer.observe(document.body, { attributes: true, attributeFilter: ['data-th-main'] });
    }

    function setupRule34() {
        const originalForm = document.querySelector('.sidebar .tag-search form');
        const gallery = document.querySelector('#post-list');
        if (!originalForm || !gallery) return;
        const formAction = originalForm.action;
        const formMethod = originalForm.method;
        const { centerWrap, searchForm, searchInput, searchButton, tagList, metatagList, metatagRowWrap } = createSearchSection('rule34');
        searchForm.action = formAction;
        searchForm.method = formMethod;
        gallery.parentNode.insertBefore(centerWrap, gallery);
        originalForm.style.display = 'none';
        tags = getTagsFromURL();
        renderTags(tagList);
        searchInput.value = '';
    }

    function setupGeneric() {
        const originalForm = findSearchForm();
        if (!originalForm) return;
        const searchField = originalForm.querySelector('input[name="tags"], textarea[name="tags"]');
        if (!searchField) return;
        const tagList = document.createElement('div');
        tagList.className = 'r34-tag-list';
        searchField.insertAdjacentElement('afterend', tagList);
        tags = getTagsFromURL();
        renderTags(tagList);
        searchField.value = '';
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

    // --- Style Injection ---
    function injectStyles() {
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
                .r34-export-btn, .r34-cheat-btn {
                    border-radius: 18px;
                    padding: 8px 18px;
                    font-size: 1.1em;
                    border: 2px solid #b0d0b0;
                    background: #f8fff8;
                    cursor: pointer;
                    transition: border-color 0.2s, background 0.2s;
                    white-space: nowrap;
                    flex-shrink: 0;
                }
                .r34-export-btn:hover, .r34-cheat-btn:hover {
                    border-color: #4a90e2;
                    background: #e0f7fa;
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
                .modal {
                    display: none;
                    position: fixed;
                    z-index: 1000;
                    left: 0; top: 0; right: 0; bottom: 0;
                    background: rgba(24, 28, 36, 0.55);
                    backdrop-filter: blur(2.5px);
                    align-items: center;
                    justify-content: center;
                    transition: background 0.2s;
                }
                .modal[style*="display: flex"] {
                    display: flex !important;
                }
                .modal-content {
                    background: #fff;
                    border-radius: 18px;
                    padding: 32px 28px 24px 28px;
                    min-width: 320px;
                    max-width: 800px;
                    width: 50vw;
                    margin: auto;
                    box-shadow: 0 8px 40px 0 rgba(0,0,0,0.18);
                    display: flex;
                    flex-direction: column;
                    gap: 18px;
                    position: relative;
                    font-size: 1.08em;
                    align-items: center;
                    max-height: 80vh;
                    overflow: auto;
                }
                .modal-close {
                    position: absolute;
                    top: 12px;
                    right: 16px;
                    background: none;
                    border: none;
                    font-size: 1.7em;
                    color: #888;
                    cursor: pointer;
                    z-index: 2;
                    padding: 0 8px;
                    line-height: 1;
                    transition: color 0.2s;
                }
                .modal-close:hover {
                    color: #c00;
                }
                .modal-content h3 {
                    margin: 0 0 8px 0;
                    font-size: 1.25em;
                    font-weight: bold;
                    text-align: left;
                    align-self: flex-start;
                }
                .modal-actions {
                    display: flex;
                    gap: 12px;
                    justify-content: flex-end;
                    margin-top: 8px;
                    flex-wrap: wrap;
                    width: 100%;
                }
                .modal-actions button {
                    border-radius: 16px;
                    padding: 8px 22px;
                    font-size: 1em;
                    border: 2px solid #b0d0b0;
                    background: #f8fff8;
                    cursor: pointer;
                    transition: border-color 0.2s, background 0.2s;
                    font-weight: 500;
                }
                .modal-actions button:hover {
                    border-color: #4a90e2;
                    background: #e0f7fa;
                }
                .modal-pastebin {
                    background: #f6f8fa;
                    border: 1.5px solid #e0e0e0;
                    border-radius: 10px;
                    padding: 12px 14px;
                    font-size: 1em;
                    width: 100%;
                    min-width: 220px;
                    max-width: 100%;
                    box-sizing: border-box;
                    color: #222;
                    margin-bottom: 0;
                    font-family: 'Fira Mono', 'Consolas', 'Menlo', 'Monaco', monospace;
                    overflow: auto;
                    box-shadow: 0 2px 8px 0 rgba(0,0,0,0.04);
                    resize: vertical;
                    height: 260px;
                    min-height: 120px;
                    max-height: 50vh;
                }
                .modal-content pre, .modal-doc {
                    background: #f6f8fa;
                    border: 1.5px solid #e0e0e0;
                    border-radius: 10px;
                    padding: 12px 14px;
                    font-size: 1em;
                    width: 100%;
                    min-width: 220px;
                    max-width: 100%;
                    box-sizing: border-box;
                    color: #222;
                    margin-bottom: 0;
                    font-family: inherit;
                    overflow: auto;
                }
                .modal-content pre {
                    white-space: pre-wrap;
                    word-break: break-word;
                    max-height: 320px;
                    overflow: auto;
                }
                .modal-doc section {
                    margin-bottom: 18px;
                }
                .modal-doc h4 {
                    margin: 0 0 6px 0;
                    font-size: 1.08em;
                    color: #4a90e2;
                    font-weight: bold;
                }
                .modal-doc ul {
                    margin: 0 0 0 18px;
                    padding: 0;
                    list-style: disc inside;
                }
                .modal-doc code {
                    background: #e6f7ff;
                    border-radius: 6px;
                    padding: 2px 6px;
                    font-size: 0.98em;
                    color: #00549e;
                }
                .modal-doc b {
                    color: #333;
                }
                .modal-tabs {
                    display: flex;
                    background: #f0f4fa;
                    border-radius: 999px;
                    padding: 4px;
                    gap: 8px;
                    margin-bottom: 16px;
                    width: 100%;
                    justify-content: flex-start;
                }
                .modal-tab {
                    border: none;
                    background: none;
                    border-radius: 999px;
                    padding: 8px 28px;
                    font-size: 1.08em;
                    font-weight: 500;
                    cursor: pointer;
                    transition: background 0.2s, color 0.2s, box-shadow 0.2s;
                    box-shadow: none;
                    outline: none;
                    margin-bottom: 0;
                    color: #00549e;
                }
                .modal-tab.active {
                    background: #4a90e2;
                    color: #fff;
                    box-shadow: 0 2px 8px 0 rgba(74,144,226,0.12);
                }
                .modal-tab:not(.active):hover {
                    background: #e6f7ff;
                    color: #00549e;
                }
                .modal-tab:focus {
                    outline: 2px solid #4a90e2;
                }
                /* Responsive for mobile */
                @media (max-width: 700px) {
                    .modal-content {
                        min-width: 0;
                        max-width: 98vw;
                        width: 98vw;
                        padding: 18px 2vw 12px 2vw;
                        font-size: 1em;
                        max-height: 98vh;
                    }
                    .modal-content h3 {
                        font-size: 1.08em;
                    }
                    .modal-actions {
                        flex-direction: column;
                        align-items: stretch;
                        gap: 8px;
                    }
                    .modal-pastebin, .modal-content pre, .modal-doc {
                        font-size: 0.98em;
                        padding: 8px 6px;
                        width: 98vw;
                        min-width: 0;
                        max-width: 100vw;
                        height: 120px;
                        min-height: 60px;
                        max-height: 30vh;
                    }
                    .modal-tabs {
                        width: 98vw;
                        min-width: 0;
                        max-width: 100vw;
                    }
                }
                /* --- Add width/centering for modal-tabs and modal-pastebin --- */
                .modal-tabs,
                .modal-pastebin {
                    width: 90%;
                    max-width: 760px;
                    min-width: 220px;
                    margin-left: auto;
                    margin-right: auto;
                }
                .modal-form {
                    width: 90%;
                    max-width: 760px;
                    min-width: 220px;
                    margin-left: auto;
                    margin-right: auto;
                    display: flex;
                    flex-direction: column;
                    align-items: stretch;
                    height: auto;
                    max-height: 100%;
                }
                @media (max-width: 700px) {
                    .modal-tabs,
                    .modal-pastebin {
                        width: 98vw;
                        max-width: 100vw;
                        min-width: 0;
                    }
                    .modal-form {
                        width: 98vw;
                        max-width: 100vw;
                        min-width: 0;
                        height: auto;
                        max-height: 100%;
                    }
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
        .r34-sort-row {
            display: flex;
            flex-direction: row;
            align-items: center;
            gap: 18px;
            width: 100%;
            margin: 8px 0 0 0;
            justify-content: flex-start;
        }
        .r34-sort-select {
            border-radius: 14px;
            padding: 7px 18px;
            font-size: 1.08em;
            border: 2px solid #b0d0b0;
            background: #f8fff8;
            cursor: pointer;
            transition: border-color 0.2s, background 0.2s;
            min-width: 90px;
            max-width: 180px;
        }
        .r34-sort-select:focus {
            border-color: #4a90e2;
            outline: none;
        }
        .r34-order-switch {
            border-radius: 14px;
            padding: 7px 18px;
            font-size: 1.08em;
            border: 2px solid #b0d0b0;
            background: #f8fff8;
            cursor: pointer;
            transition: border-color 0.2s, background 0.2s;
            font-weight: 500;
            color: #00549e;
            min-width: 120px;
        }
        .r34-order-switch:focus {
            border-color: #4a90e2;
            outline: none;
        }
        .r34-order-switch[style*="display: none"] {
            display: none !important;
        }
        .r34-rating-label {
            display: flex;
            align-items: center;
            gap: 4px;
            font-size: 1.08em;
            font-weight: 500;
            color: #00549e;
            background: #e6f7ff;
            border-radius: 10px;
            padding: 4px 12px;
            border: 1.5px solid #b0d0b0;
            margin-right: 4px;
            cursor: pointer;
            transition: background 0.2s, border-color 0.2s;
        }
        .r34-rating-checkbox {
            accent-color: #4a90e2;
            width: 1.1em;
            height: 1.1em;
        }
        .r34-rating-label:hover {
            background: #d0eaff;
            border-color: #4a90e2;
        }
        /* Metatag Row */
        .r34-metatag-row-wrap {
            width: 100%;
            margin: 10px 0 0 0;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 4px;
        }
        .r34-metatag-row-header {
            display: flex;
            flex-direction: row;
            align-items: center;
            gap: 12px;
            font-size: 1.08em;
            font-weight: 600;
            color: #00549e;
            margin-bottom: 2px;
        }
        .r34-metatag-toggle {
            border-radius: 10px;
            padding: 4px 16px;
            font-size: 1em;
            border: 2px solid #b0d0b0;
            background: #f8fff8;
            cursor: pointer;
            transition: border-color 0.2s, background 0.2s;
            font-weight: 500;
            color: #00549e;
        }
        .r34-metatag-toggle:focus {
            border-color: #4a90e2;
            outline: none;
        }
        .r34-metatag-list {
            display: flex;
            flex-direction: row;
            flex-wrap: wrap;
            gap: 10px;
            width: 100%;
            margin-top: 2px;
            justify-content: center;
            margin-left: auto;
            margin-right: auto;
        }
        .r34-metatag-item {
            background: #e6f7ff;
            border: 1.5px solid #7ecfff;
            color: #00549e;
        }
        @media (max-width: 700px) {
            .r34-sort-row {
                flex-direction: column;
                align-items: stretch;
                gap: 10px;
            }
            .r34-metatag-row-header {
                flex-direction: column;
                align-items: flex-start;
                gap: 4px;
            }
            .r34-metatag-list {
                gap: 6px;
            }
        }
        /* Include/Exclude Tag Rows */
        .r34-include-row-wrap, .r34-exclude-row-wrap {
            width: 100%;
            margin: 10px 0 0 0;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 4px;
        }
        .r34-include-row-header, .r34-exclude-row-header {
            display: flex;
            flex-direction: row;
            align-items: center;
            gap: 12px;
            font-size: 1.08em;
            font-weight: 600;
            color: #00549e;
            margin-bottom: 2px;
        }
        .r34-include-toggle, .r34-exclude-toggle {
            border-radius: 10px;
            padding: 4px 16px;
            font-size: 1em;
            border: 2px solid #b0d0b0;
            background: #f8fff8;
            cursor: pointer;
            transition: border-color 0.2s, background 0.2s;
            font-weight: 500;
            color: #00549e;
        }
        .r34-include-toggle:focus, .r34-exclude-toggle:focus {
            border-color: #4a90e2;
            outline: none;
        }
        .r34-include-list, .r34-exclude-list {
            display: flex;
            flex-direction: row;
            flex-wrap: wrap;
            gap: 10px;
            width: 100%;
            margin-top: 2px;
            justify-content: center;
            margin-left: auto;
            margin-right: auto;
        }
        .r34-include-item, .r34-exclude-item {
            background: #e6f7ff;
            border: 1.5px solid #7ecfff;
            color: #00549e;
        }
        @media (max-width: 700px) {
            .r34-include-row-header, .r34-exclude-row-header {
                flex-direction: column;
                align-items: flex-start;
                gap: 4px;
            }
            .r34-include-list, .r34-exclude-list {
                gap: 6px;
            }
        }
    `;
    document.head.appendChild(style);
    }

    // --- e621 Autocomplete hijack: expose jQuery UI Autocomplete instance ---
    function hijackE621Autocomplete() {
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
    }

    // --- Main Entrypoint ---
    function init() {
        injectStyles();
        hijackE621Autocomplete();
        if (isE621) {
            setupE621();
        } else if (isRule34) {
            setupRule34();
        } else {
            setupGeneric();
        }
    }

    // --- Run ---
    init();

})(); 