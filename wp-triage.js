(function() {
    const STORAGE_KEY = 'wp_triage_kept';

    const state = {
        postTypes: [],
        currentType: null,
        posts: [],
        currentIndex: -1,
        reviewed: new Set(),
        linksOut: {},
        linksIn: {},
        traffic: {},
        kept: new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')),
        selected: new Set(),
        isMobileView: false,
    };

    function saveKept() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify([...state.kept]));
    }

    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    // URL State Management
    function updateURL() {
        const params = new URLSearchParams(window.location.search);
        params.set('page', 'wp-triage'); // Keep WP admin page param

        if (state.currentType) {
            params.set('type', state.currentType);
        } else {
            params.delete('type');
        }

        const currentPost = state.posts[state.currentIndex];
        if (currentPost) {
            params.set('post', currentPost.id);
        } else {
            params.delete('post');
        }

        const newURL = `${window.location.pathname}?${params.toString()}`;
        window.history.replaceState({}, '', newURL);
    }

    function getURLParams() {
        const params = new URLSearchParams(window.location.search);
        return {
            type: params.get('type'),
            postId: params.get('post') ? parseInt(params.get('post'), 10) : null
        };
    }

    function ajax(action, data = {}) {
        const form = new FormData();
        form.append('action', action);
        form.append('nonce', wpTriage.nonce);
        for (const [k, v] of Object.entries(data)) {
            form.append(k, v);
        }
        return fetch(wpTriage.ajaxUrl, { method: 'POST', body: form })
            .then(r => r.json());
    }

    function getTotalRemaining() {
        // Sum up all post counts across all types, minus kept posts
        const totalPosts = state.postTypes.reduce((sum, t) => sum + t.count, 0);
        return totalPosts - state.kept.size;
    }

    function renderPostTypes() {
        const ul = $('.wp-triage-types');
        const countEl = $('.wp-triage-types-count');

        // Update the count pill with total remaining
        if (countEl) {
            countEl.textContent = getTotalRemaining();
        }

        ul.innerHTML = state.postTypes.map(t => `
            <li>
                <button data-type="${t.name}">
                    <span class="label">${t.label}</span>
                    <span class="count">${t.count}</span>
                </button>
            </li>
        `).join('');

        ul.querySelectorAll('button').forEach(btn => {
            btn.addEventListener('click', () => selectType(btn.dataset.type));
        });
    }

    function selectType(typeName, initialPostId = null) {
        state.currentType = typeName;
        state.reviewed.clear();

        $$('.wp-triage-types button').forEach(b => b.classList.remove('active'));
        $(`.wp-triage-types button[data-type="${typeName}"]`).classList.add('active');

        // Slide to posts panel
        $('.wp-triage-nav-slide').classList.add('show-posts');

        // Show loading state
        $('.wp-triage-posts').innerHTML = '<li class="wp-triage-loading">Loading...</li>';

        ajax('wp_triage_get_posts', { post_type: typeName }).then(res => {
            if (!res.success) return;
            state.posts = res.data;
            state.currentIndex = -1;
            renderPosts();

            // If we have an initial post ID from URL, load that specific post
            if (initialPostId) {
                const postIndex = state.posts.findIndex(p => p.id === initialPostId);
                if (postIndex !== -1) {
                    state.currentIndex = postIndex;
                    loadPost(initialPostId);
                    return;
                }
            }
            nextPost();
        });
    }

    function goBackToTypes() {
        $('.wp-triage-nav-slide').classList.remove('show-posts');
        state.currentType = null;
        state.currentIndex = -1;
        $$('.wp-triage-types button').forEach(b => b.classList.remove('active'));
        updateURL();
    }

    function renderPosts() {
        const title = $('.wp-triage-posts-title');
        const ul = $('.wp-triage-posts');
        const remaining = $('.wp-triage-remaining');

        const typeObj = state.postTypes.find(t => t.name === state.currentType);
        title.textContent = typeObj ? typeObj.label : '';

        // Calculate remaining (total minus kept)
        const keptCount = state.posts.filter(p => state.kept.has(p.id)).length;
        const remainingCount = state.posts.length - keptCount;
        remaining.textContent = `${remainingCount} left`;

        // Update back button count (total across all types)
        const backCount = $('.wp-triage-back-count');
        if (backCount) {
            backCount.textContent = `${getTotalRemaining()} left`;
        }

        // Clear selections when re-rendering
        state.selected.clear();
        updateBulkActions();

        ul.innerHTML = state.posts.map((p, i) => `
            <li>
                <button data-index="${i}" class="${state.reviewed.has(p.id) ? 'done' : ''}">
                    <label class="wp-triage-post-checkbox" onclick="event.stopPropagation()">
                        <input type="checkbox" data-post-id="${p.id}">
                    </label>
                    <span class="post-title-text">${p.title}</span>
                    ${p.status !== 'publish' ? `<span class="status-badge ${p.status}">${p.status.charAt(0).toUpperCase() + p.status.slice(1)}</span>` : ''}
                </button>
            </li>
        `).join('');

        ul.querySelectorAll('button').forEach(btn => {
            btn.addEventListener('click', () => {
                state.currentIndex = parseInt(btn.dataset.index, 10);
                loadPost(state.posts[state.currentIndex].id);
            });
        });

        ul.querySelectorAll('.wp-triage-post-checkbox input').forEach(cb => {
            cb.addEventListener('change', (e) => {
                e.stopPropagation();
                const postId = parseInt(cb.dataset.postId, 10);
                if (cb.checked) {
                    state.selected.add(postId);
                } else {
                    state.selected.delete(postId);
                }
                updateBulkActions();
            });
        });
    }

    function updateBulkActions() {
        const bulkActions = $('.wp-triage-bulk-actions');
        const bulkCount = $('.wp-triage-bulk-count');
        if (state.selected.size > 0) {
            bulkActions.style.display = 'block';
            bulkCount.textContent = state.selected.size;
        } else {
            bulkActions.style.display = 'none';
        }
    }

    function updatePostList() {
        $$('.wp-triage-posts button').forEach((btn, i) => {
            btn.classList.toggle('active', i === state.currentIndex);
            btn.classList.toggle('done', state.reviewed.has(state.posts[i].id));
        });

        // Update remaining count
        const remaining = $('.wp-triage-remaining');
        const keptCount = state.posts.filter(p => state.kept.has(p.id)).length;
        const remainingCount = state.posts.length - keptCount;
        remaining.textContent = `${remainingCount} left`;

        // Update back button count (total across all types)
        const backCount = $('.wp-triage-back-count');
        if (backCount) {
            backCount.textContent = `${getTotalRemaining()} left`;
        }
    }

    function nextPost() {
        for (let i = state.currentIndex + 1; i < state.posts.length; i++) {
            if (!state.reviewed.has(state.posts[i].id)) {
                state.currentIndex = i;
                loadPost(state.posts[i].id);
                return;
            }
        }

        const nextTypeIndex = state.postTypes.findIndex(t => t.name === state.currentType) + 1;
        if (nextTypeIndex < state.postTypes.length) {
            selectType(state.postTypes[nextTypeIndex].name);
        } else {
            showDone();
        }
    }

    function loadPost(postId) {
        updatePostList();
        updateURL();

        ajax('wp_triage_get_post_meta', { post_id: postId }).then(res => {
            if (!res.success) return;
            showPost(res.data);
        });
    }

    function getSlugFromPermalink(permalink) {
        try {
            const url = new URL(permalink);
            let path = url.pathname;
            // Remove leading/trailing slashes and return
            path = path.replace(/^\/|\/$/g, '');
            return path || '/';
        } catch (e) {
            return '';
        }
    }

    function showPost(data) {
        $('.wp-triage-empty').style.display = 'none';
        $('.wp-triage-done').style.display = 'none';
        $('.wp-triage-content').style.display = 'flex';

        $('.wp-triage-title').textContent = data.title;
        $('.meta-type').textContent = data.post_type;
        $('.meta-status').textContent = data.status;
        // Render categories as pills
        const categoriesEl = $('.meta-categories');
        if (data.categories.length) {
            categoriesEl.innerHTML = data.categories.map(cat =>
                `<span class="meta-pill"><span class="meta-pill-text">${cat}</span><button class="meta-pill-remove" data-type="category" data-value="${cat}">&times;</button></span>`
            ).join('');
        } else {
            categoriesEl.innerHTML = '<span class="meta-none">None</span>';
        }

        // Render tags as pills
        const tagsEl = $('.meta-tags');
        if (data.tags.length) {
            tagsEl.innerHTML = data.tags.map(tag =>
                `<span class="meta-pill"><span class="meta-pill-text">${tag}</span><button class="meta-pill-remove" data-type="tag" data-value="${tag}">&times;</button></span>`
            ).join('');
        } else {
            tagsEl.innerHTML = '<span class="meta-none">None</span>';
        }

        // Add click handlers for pill remove buttons
        $$('.meta-pill-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                openModal();
            });
        });
        const linksOut = state.linksOut[data.id] || [];
        const linksIn = state.linksIn[data.id] || [];
        $('.meta-links-out').textContent = linksOut.length || 'Zero';
        $('.meta-links-in-count').textContent = linksIn.length || 'Zero';

        // GA Performance data
        const slug = getSlugFromPermalink(data.permalink);
        const traffic = state.traffic[slug] || {};
        const sessions = traffic.sessions || 0;

        $('.meta-sessions').textContent = sessions.toLocaleString();
        $('.meta-active-users').textContent = (traffic.active_users || 0).toLocaleString();
        $('.meta-new-users').textContent = (traffic.new_users || 0).toLocaleString();
        $('.meta-engagement').textContent = traffic.avg_engagement_time ? `${traffic.avg_engagement_time}s` : '—';
        $('.meta-key-events').textContent = (traffic.key_events || 0).toLocaleString();

        // Badges
        const keptBadge = $('.meta-kept-badge');
        if (keptBadge) {
            keptBadge.style.display = state.kept.has(data.id) ? 'inline-block' : 'none';
        }

        const top100Badge = $('.meta-top100-badge');
        if (top100Badge) {
            top100Badge.style.display = sessions >= 75 ? 'inline-block' : 'none';
        }

        // Top Level badge - show if slug has no slashes (direct child of root)
        const topLevelBadge = $('.meta-toplevel-badge');
        if (topLevelBadge) {
            const isTopLevel = slug && slug !== '/' && !slug.includes('/');
            topLevelBadge.style.display = isTopLevel ? 'inline-block' : 'none';
        }

        // Preview action bar links
        $('.wp-triage-view-live').href = data.permalink;
        $('.wp-triage-edit-content').href = data.edit_link;

        // AI internal linking helper - always use production domain
        const productionPermalink = data.permalink.replace(/^https?:\/\/[^\/]+/, 'https://sourceday.com');
        const aiPrompt = `The content at ${productionPermalink} is valuable and needs more internal links pointing to it. Analyze my site and find THREE existing pages or posts that should link TO this content. For each, explain where the link should be placed and what anchor text to use.`;
        $('.meta-links-in-ai').href = `https://chatgpt.com/g/g-692755ed9bf0819182ad27cedf7d22d2?prompt=${encodeURIComponent(aiPrompt)}`;

        const iframe = $('.wp-triage-preview');
        iframe.src = data.permalink + (data.permalink.includes('?') ? '&' : '?') + 'preview=true';
    }

    function showDone() {
        $('.wp-triage-empty').style.display = 'none';
        $('.wp-triage-content').style.display = 'none';
        $('.wp-triage-done').style.display = 'flex';
    }

    function unpublish() {
        const post = state.posts[state.currentIndex];
        if (!post) return;

        ajax('wp_triage_unpublish', { post_id: post.id }).then(res => {
            if (!res.success) return;
            post.status = 'draft';
            state.reviewed.add(post.id);
            renderPosts();
            nextPost();
        });
    }

    function keep() {
        const post = state.posts[state.currentIndex];
        if (!post) return;
        state.kept.add(post.id);
        saveKept();
        state.reviewed.add(post.id);
        renderPosts();
        nextPost();
    }

    function openModal() {
        $('.wp-triage-modal-overlay:not(.wp-triage-bulk-modal-overlay)').style.display = 'flex';
    }

    function closeModal() {
        $('.wp-triage-modal-overlay:not(.wp-triage-bulk-modal-overlay)').style.display = 'none';
    }

    function openBulkModal() {
        const count = state.selected.size;
        $('.wp-triage-bulk-summary').textContent = `${count} item${count !== 1 ? 's' : ''} selected`;
        $('.wp-triage-bulk-modal-overlay').style.display = 'flex';
    }

    function closeBulkModal() {
        $('.wp-triage-bulk-modal-overlay').style.display = 'none';
    }

    function toggleViewport() {
        state.isMobileView = !state.isMobileView;
        const container = $('.wp-triage-preview-container');
        const btn = $('.wp-triage-toggle-viewport');

        if (state.isMobileView) {
            container.classList.add('mobile-view');
            btn.textContent = 'Desktop';
        } else {
            container.classList.remove('mobile-view');
            btn.textContent = 'Mobile';
        }
    }

    function bulkUnpublish() {
        const selectedIds = [...state.selected];
        let completed = 0;

        selectedIds.forEach(postId => {
            ajax('wp_triage_unpublish', { post_id: postId }).then(res => {
                if (res.success) {
                    const post = state.posts.find(p => p.id === postId);
                    if (post) post.status = 'draft';
                    state.reviewed.add(postId);
                }
                completed++;
                if (completed === selectedIds.length) {
                    state.selected.clear();
                    renderPosts();
                    closeBulkModal();
                    nextPost();
                }
            });
        });
    }

    function bulkKeep() {
        const selectedIds = [...state.selected];
        selectedIds.forEach(postId => {
            state.kept.add(postId);
            state.reviewed.add(postId);
        });
        saveKept();
        state.selected.clear();
        renderPosts();
        closeBulkModal();
        nextPost();
    }

    document.addEventListener('DOMContentLoaded', () => {
        // Collapse WP admin sidebar for more space
        document.body.classList.add('folded');

        // Get URL params for restoring state
        const urlParams = getURLParams();

        // Load post types and restore state from URL if present
        ajax('wp_triage_get_post_types').then(res => {
            if (!res.success) return;
            state.postTypes = res.data;
            renderPostTypes();

            // If URL has a type, restore that view
            if (urlParams.type) {
                selectType(urlParams.type, urlParams.postId);
            }
        });

        ajax('wp_triage_get_link_map').then(res => {
            if (!res.success) return;
            state.linksOut = res.data.out;
            state.linksIn = res.data.in;
        });

        ajax('wp_triage_get_traffic').then(res => {
            if (!res.success) return;
            state.traffic = res.data;
        });

        $('.wp-triage-unpublish').addEventListener('click', unpublish);
        $('.wp-triage-keep').addEventListener('click', keep);
        $('.wp-triage-back-btn').addEventListener('click', goBackToTypes);

        // Modal handlers
        $('.wp-triage-permissions-btn').addEventListener('click', openModal);
        $('.wp-triage-modal-close:not(.wp-triage-bulk-modal-close)').addEventListener('click', closeModal);
        $('.wp-triage-modal-save').addEventListener('click', closeModal);
        $('.wp-triage-modal-overlay:not(.wp-triage-bulk-modal-overlay)').addEventListener('click', (e) => {
            if (e.target === $('.wp-triage-modal-overlay:not(.wp-triage-bulk-modal-overlay)')) {
                closeModal();
            }
        });

        // Bulk actions handlers
        $('.wp-triage-bulk-btn').addEventListener('click', openBulkModal);
        $('.wp-triage-bulk-modal-close').addEventListener('click', closeBulkModal);
        $('.wp-triage-bulk-unpublish').addEventListener('click', bulkUnpublish);
        $('.wp-triage-bulk-keep').addEventListener('click', bulkKeep);
        $('.wp-triage-bulk-modal-overlay').addEventListener('click', (e) => {
            if (e.target === $('.wp-triage-bulk-modal-overlay')) {
                closeBulkModal();
            }
        });

        // Viewport toggle handler
        $('.wp-triage-toggle-viewport').addEventListener('click', toggleViewport);

        document.addEventListener('keydown', (e) => {
            // Close bulk modal on Escape if open
            if (e.key === 'Escape' && $('.wp-triage-bulk-modal-overlay').style.display === 'flex') {
                closeBulkModal();
                return;
            }

            // Close permissions modal on Escape if open
            if (e.key === 'Escape' && $('.wp-triage-modal-overlay:not(.wp-triage-bulk-modal-overlay)').style.display === 'flex') {
                closeModal();
                return;
            }

            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            // Space to keep
            if (e.key === ' ' || e.code === 'Space') {
                e.preventDefault();
                keep();
            }

            // Escape to unpublish (only if modal is closed)
            if (e.key === 'Escape') {
                unpublish();
            }

            // Legacy shortcuts
            if (e.key === 'ArrowLeft' || e.key === 'u') unpublish();
            if (e.key === 'ArrowRight' || e.key === 'k') keep();

            // Up/Down arrows to navigate posts in sidebar
            if (e.key === 'ArrowUp' && state.posts.length > 0) {
                e.preventDefault();
                const newIndex = Math.max(0, state.currentIndex - 1);
                if (newIndex !== state.currentIndex) {
                    state.currentIndex = newIndex;
                    loadPost(state.posts[state.currentIndex].id);
                }
            }
            if (e.key === 'ArrowDown' && state.posts.length > 0) {
                e.preventDefault();
                const newIndex = Math.min(state.posts.length - 1, state.currentIndex + 1);
                if (newIndex !== state.currentIndex) {
                    state.currentIndex = newIndex;
                    loadPost(state.posts[state.currentIndex].id);
                }
            }
        });
    });
})();
