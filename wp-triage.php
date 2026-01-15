<?php
/**
 * Plugin Name: WP Triage
 * Description: Quickly review and unpublish content, one post at a time.
 * Version: 1.0.0
 * Author: You
 */

if (!defined('ABSPATH')) exit;

add_action('admin_menu', function() {
    add_menu_page(
        'WP Triage',
        'WP Triage',
        'edit_posts',
        'wp-triage',
        'wp_triage_render_page',
        'dashicons-visibility',
        30
    );
});

add_action('admin_enqueue_scripts', function($hook) {
    if ($hook !== 'toplevel_page_wp-triage') return;
    wp_enqueue_style('material-symbols', 'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20,300,0,0&display=swap', [], null);
    wp_enqueue_style('wp-triage', plugin_dir_url(__FILE__) . 'wp-triage.css', ['material-symbols'], '1.0.0');
    wp_enqueue_script('wp-triage', plugin_dir_url(__FILE__) . 'wp-triage.js', [], '1.0.0', true);
    wp_localize_script('wp-triage', 'wpTriage', [
        'ajaxUrl' => admin_url('admin-ajax.php'),
        'nonce' => wp_create_nonce('wp_triage_nonce'),
    ]);
});

add_action('wp_ajax_wp_triage_get_post_types', function() {
    check_ajax_referer('wp_triage_nonce', 'nonce');
    $types = get_post_types(['public' => true], 'objects');
    $result = [];
    foreach ($types as $type) {
        if ($type->name === 'attachment') continue;
        $result[] = [
            'name' => $type->name,
            'label' => $type->label,
            'count' => wp_count_posts($type->name)->publish + wp_count_posts($type->name)->draft + wp_count_posts($type->name)->pending + wp_count_posts($type->name)->private,
        ];
    }
    wp_send_json_success($result);
});

add_action('wp_ajax_wp_triage_get_link_map', function() {
    check_ajax_referer('wp_triage_nonce', 'nonce');

    $types = get_post_types(['public' => true], 'names');
    unset($types['attachment']);

    $posts = get_posts([
        'post_type' => array_values($types),
        'post_status' => ['publish', 'draft', 'pending', 'private'],
        'numberposts' => -1,
    ]);

    // Build permalink -> ID map
    $permalink_to_id = [];
    foreach ($posts as $p) {
        $permalink_to_id[get_permalink($p->ID)] = $p->ID;
    }

    // Get site URL for internal link detection
    $site_host = parse_url(home_url(), PHP_URL_HOST);

    // Build outbound links map: post_id => [linked_post_ids]
    $links_out = [];
    foreach ($posts as $p) {
        $links_out[$p->ID] = [];

        preg_match_all('/<a\s[^>]*href=["\']([^"\']+)["\'][^>]*>/i', $p->post_content, $matches);

        if (empty($matches[1])) continue;

        foreach ($matches[1] as $url) {
            // Skip external links
            $url_host = parse_url($url, PHP_URL_HOST);
            if ($url_host && $url_host !== $site_host) continue;

            // Normalize URL
            $url = strtok($url, '#'); // Remove anchors
            $url = trailingslashit($url);

            // Try direct permalink match
            if (isset($permalink_to_id[$url])) {
                $linked_id = $permalink_to_id[$url];
                if ($linked_id !== $p->ID && !in_array($linked_id, $links_out[$p->ID])) {
                    $links_out[$p->ID][] = $linked_id;
                }
                continue;
            }

            // Try url_to_postid for relative/alternate URLs
            $post_id = url_to_postid($url);
            if ($post_id && $post_id !== $p->ID && !in_array($post_id, $links_out[$p->ID])) {
                $links_out[$p->ID][] = $post_id;
            }
        }
    }

    // Build inbound links map: post_id => [posts_linking_to_it]
    $links_in = [];
    foreach ($posts as $p) {
        $links_in[$p->ID] = [];
    }
    foreach ($links_out as $from_id => $to_ids) {
        foreach ($to_ids as $to_id) {
            if (isset($links_in[$to_id])) {
                $links_in[$to_id][] = $from_id;
            }
        }
    }

    wp_send_json_success([
        'out' => $links_out,
        'in' => $links_in,
    ]);
});

add_action('wp_ajax_wp_triage_get_posts', function() {
    check_ajax_referer('wp_triage_nonce', 'nonce');
    $post_type = sanitize_key($_POST['post_type'] ?? 'post');
    $posts = get_posts([
        'post_type' => $post_type,
        'post_status' => ['publish', 'draft', 'pending', 'private'],
        'numberposts' => -1,
        'orderby' => 'title',
        'order' => 'ASC',
    ]);
    $result = [];
    foreach ($posts as $p) {
        $result[] = [
            'id' => $p->ID,
            'title' => $p->post_title ?: '(no title)',
            'status' => $p->post_status,
        ];
    }
    wp_send_json_success($result);
});

add_action('wp_ajax_wp_triage_get_post_meta', function() {
    check_ajax_referer('wp_triage_nonce', 'nonce');
    $post_id = intval($_POST['post_id'] ?? 0);
    $post = get_post($post_id);
    if (!$post) wp_send_json_error('Post not found');

    $categories = wp_get_post_categories($post_id, ['fields' => 'names']);
    $tags = wp_get_post_tags($post_id, ['fields' => 'names']);

    wp_send_json_success([
        'id' => $post->ID,
        'title' => $post->post_title ?: '(no title)',
        'post_type' => $post->post_type,
        'status' => $post->post_status,
        'categories' => $categories,
        'tags' => $tags,
        'permalink' => get_permalink($post_id),
        'edit_link' => get_edit_post_link($post_id, 'raw'),
    ]);
});

add_action('wp_ajax_wp_triage_unpublish', function() {
    check_ajax_referer('wp_triage_nonce', 'nonce');
    $post_id = intval($_POST['post_id'] ?? 0);
    $post = get_post($post_id);
    if (!$post) wp_send_json_error('Post not found');

    wp_update_post([
        'ID' => $post_id,
        'post_status' => 'draft',
    ]);

    wp_send_json_success(['id' => $post_id, 'status' => 'draft']);
});

function wp_triage_load_traffic_data() {
    static $traffic_data = null;

    if ($traffic_data !== null) {
        return $traffic_data;
    }

    $traffic_data = [];
    $csv_file = plugin_dir_path(__FILE__) . 'traffic.csv';

    if (!file_exists($csv_file)) {
        return $traffic_data;
    }

    $handle = fopen($csv_file, 'r');
    if (!$handle) {
        return $traffic_data;
    }

    // Skip header row
    $headers = fgetcsv($handle);

    while (($row = fgetcsv($handle)) !== false) {
        if (count($row) < 6) continue;

        $slug = trim($row[0], '/');
        if (empty($slug)) $slug = '/'; // Homepage

        $traffic_data[$slug] = [
            'sessions' => intval($row[1]),
            'active_users' => intval($row[2]),
            'new_users' => intval($row[3]),
            'avg_engagement_time' => intval($row[4]),
            'key_events' => intval($row[5]),
        ];
    }

    fclose($handle);
    return $traffic_data;
}

add_action('wp_ajax_wp_triage_get_traffic', function() {
    check_ajax_referer('wp_triage_nonce', 'nonce');
    wp_send_json_success(wp_triage_load_traffic_data());
});

function wp_triage_render_page() {
    ?>
    <div class="wrap" id="wp-triage-app">
        <div class="wp-triage-layout">
            <aside class="wp-triage-sidebar">
                <div class="wp-triage-nav-container">
                    <div class="wp-triage-nav-slide">
                        <div class="wp-triage-types-panel">
                            <h2>
                                <span class="wp-triage-types-label">
                                    <span class="material-symbols-outlined">book_5</span>
                                    Your Post Types
                                </span>
                                <span class="wp-triage-types-count"></span>
                            </h2>
                            <ul class="wp-triage-types"></ul>
                        </div>
                        <div class="wp-triage-posts-panel">
                            <div class="wp-triage-posts-panel-scroll">
                                <button class="wp-triage-back-btn"><span>&larr; All Types</span><span class="wp-triage-back-count"></span></button>
                                <h2>
                                    <span class="wp-triage-posts-label">
                                        <span class="material-symbols-outlined">lab_profile</span>
                                        <span class="wp-triage-posts-title"></span>
                                    </span>
                                    <span class="wp-triage-remaining"></span>
                                </h2>
                                <ul class="wp-triage-posts"></ul>
                            </div>
                            <div class="wp-triage-bulk-actions" style="display:none;">
                                <button class="wp-triage-bulk-btn">Actions <span class="wp-triage-bulk-count"></span></button>
                            </div>
                        </div>
                    </div>
                </div>
            </aside>
            <main class="wp-triage-main">
                <div class="wp-triage-empty">Select a post type to begin</div>
                <div class="wp-triage-content" style="display:none;">
                    <div class="wp-triage-left">
                        <div class="wp-triage-meta">
                            <div class="wp-triage-badges">
                                <span class="meta-kept-badge">Kept</span>
                                <span class="meta-top100-badge">Top 100</span>
                                <span class="meta-toplevel-badge">Top Level</span>
                            </div>
                            <h1 class="wp-triage-title"></h1>

                            <table class="wp-triage-details">
                                <tr><th><span class="material-symbols-outlined">description</span>Post Type</th><td class="meta-type"></td></tr>
                                <tr><th><span class="material-symbols-outlined">toggle_on</span>Status</th><td class="meta-status"></td></tr>
                                <tr><th><span class="material-symbols-outlined">folder</span>Categories</th><td class="meta-categories"></td></tr>
                                <tr><th><span class="material-symbols-outlined">sell</span>Tags</th><td class="meta-tags"></td></tr>
                                <tr><th><span class="material-symbols-outlined">arrow_outward</span>Links Out</th><td class="meta-links-out"></td></tr>
                                <tr><th><span class="material-symbols-outlined">arrow_insert</span>Links In</th><td class="meta-links-in"><span class="meta-links-in-count"></span><a class="meta-links-in-ai" href="#" target="_blank" title="Get AI suggestions for internal links"><svg class="ai-sparkle-icon" width="14" height="14" viewBox="0 0 65 65" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M32.4473 0C33.1278 0 33.7197 0.46478 33.8857 1.125C34.3947 3.1444 35.0586 5.1141 35.8848 7.0303C38.0369 12.0299 40.99 16.406 44.7393 20.1553C48.4903 23.9045 52.8647 26.8576 57.8643 29.0098C59.7821 29.8359 61.7502 30.4998 63.7695 31.0088C64.4297 31.1748 64.8944 31.7668 64.8945 32.4473C64.8945 33.1278 64.4298 33.7198 63.7695 33.8857C61.7502 34.3947 59.7803 35.0586 57.8643 35.8848C52.8646 38.037 48.4885 40.99 44.7393 44.7393C40.99 48.4904 38.037 52.8646 35.8848 57.8643C35.0586 59.7822 34.3947 61.7502 33.8857 63.7695C33.7198 64.4298 33.1278 64.8945 32.4473 64.8945C31.7668 64.8944 31.1748 64.4297 31.0088 63.7695C30.4998 61.7502 29.8359 59.7803 29.0098 57.8643C26.8576 52.8647 23.9063 48.4885 20.1553 44.7393C16.4041 40.99 12.0299 38.0369 7.0303 35.8848C5.1123 35.0586 3.1444 34.3947 1.125 33.8857C0.46478 33.7197 0 33.1278 0 32.4473C8.6765e-05 31.7668 0.46483 31.1748 1.125 31.0088C3.1444 30.4998 5.1141 29.836 7.0303 29.0098C12.03 26.8575 16.406 23.9046 20.1553 20.1553C23.9046 16.406 26.8575 12.03 29.0098 7.0303C29.836 5.1123 30.4998 3.1445 31.0088 1.125C31.1748 0.46483 31.7668 0.0001 32.4473 0Z" fill="url(#paint0_linear_ai_sparkle)"/><defs><linearGradient id="paint0_linear_ai_sparkle" x1="18.4473" y1="43.42" x2="52.1533" y2="15.004" gradientUnits="userSpaceOnUse"><stop stop-color="#4893FC"/><stop offset="0.27" stop-color="#4893FC"/><stop offset="0.77698" stop-color="#969DFF"/><stop offset="1" stop-color="#BD99FE"/></linearGradient></defs></svg></a></td></tr>
                            </table>

                            <h4 class="meta-section-title">GA Performance</h4>
                            <table class="wp-triage-details wp-triage-ga">
                                <tr><th><span class="material-symbols-outlined">browse_activity</span>Sessions</th><td class="meta-sessions"></td></tr>
                                <tr><th><span class="material-symbols-outlined">group</span>Active Users</th><td class="meta-active-users"></td></tr>
                                <tr><th><span class="material-symbols-outlined">person_add</span>New Users</th><td class="meta-new-users"></td></tr>
                                <tr><th><span class="material-symbols-outlined">timer</span>Avg Time</th><td class="meta-engagement"></td></tr>
                                <tr><th><span class="material-symbols-outlined">conversion_path</span>Key Events</th><td class="meta-key-events"></td></tr>
                            </table>
                        </div>
                        <div class="wp-triage-actions">
                            <button class="wp-triage-unpublish">Unpublish <kbd>esc</kbd></button>
                            <button class="wp-triage-keep">Keep <kbd>space</kbd></button>
                        </div>
                    </div>
                    <div class="wp-triage-right">
                        <div class="wp-triage-canvas">
                            <div class="wp-triage-preview-container">
                                <div class="wp-triage-preview-wrap">
                                    <iframe class="wp-triage-preview" sandbox="allow-same-origin allow-scripts"></iframe>
                                </div>
                            </div>
                            <div class="wp-triage-preview-actions">
                                <a class="wp-triage-view-live" href="#" target="_blank">Live</a>
                                <a class="wp-triage-edit-content" href="#" target="_blank">Edit</a>
                                <button class="wp-triage-toggle-viewport">Mobile</button>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="wp-triage-done" style="display:none;">
                    <p>All done! No more posts to review.</p>
                </div>
            </main>
        </div>
        <footer class="wp-triage-footer">
            <div class="wp-triage-footer-left">
                <span class="wp-triage-brand">WP Triage</span>
                <button class="wp-triage-permissions-btn">Permissions</button>
            </div>
            <nav class="wp-triage-footer-nav">
                <a href="https://wims.vc" target="_blank">Made by wims.vc</a>
                <a href="https://wims.vc/contact" target="_blank">Inquire</a>
                <a href="https://github.com" target="_blank">Support</a>
            </nav>
        </footer>

        <div class="wp-triage-modal-overlay" style="display:none;">
            <div class="wp-triage-modal">
                <div class="wp-triage-modal-header">
                    <h2>Permissions</h2>
                    <button class="wp-triage-modal-close">&times;</button>
                </div>
                <div class="wp-triage-modal-body">
                    <div class="wp-triage-setting">
                        <label>
                            <input type="checkbox" checked>
                            <span>Mark posts as "draft"</span>
                        </label>
                        <span class="wp-triage-setting-pill safe">Non destructive</span>
                    </div>
                    <div class="wp-triage-setting">
                        <label>
                            <input type="checkbox">
                            <span>Make new tracking post meta</span>
                        </label>
                        <span class="wp-triage-setting-pill safe">Non destructive</span>
                    </div>
                    <div class="wp-triage-setting">
                        <label>
                            <input type="checkbox">
                            <span>Edit tags/categories/taxonomies</span>
                        </label>
                        <span class="wp-triage-setting-pill warn">Metadata edit rights</span>
                    </div>
                    <div class="wp-triage-setting">
                        <label>
                            <input type="checkbox">
                            <span>Actually delete posts</span>
                        </label>
                        <span class="wp-triage-setting-pill danger">Destructive, with confirm</span>
                    </div>
                </div>
                <div class="wp-triage-modal-footer">
                    <button class="wp-triage-modal-save">Save Changes</button>
                </div>
            </div>
        </div>

        <div class="wp-triage-modal-overlay wp-triage-bulk-modal-overlay" style="display:none;">
            <div class="wp-triage-modal">
                <div class="wp-triage-modal-header">
                    <h2>Bulk Actions</h2>
                    <button class="wp-triage-modal-close wp-triage-bulk-modal-close">&times;</button>
                </div>
                <div class="wp-triage-modal-body wp-triage-bulk-modal-body">
                    <p class="wp-triage-bulk-summary"></p>
                </div>
                <div class="wp-triage-modal-footer wp-triage-bulk-modal-footer">
                    <button class="wp-triage-bulk-unpublish">Unpublish All</button>
                    <button class="wp-triage-bulk-keep">Keep All</button>
                </div>
            </div>
        </div>
    </div>
    <?php
}
