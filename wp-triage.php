<?php
/**
 * Plugin Name: Triage WP
 * Description: Quickly review and unpublish content, one post at a time.
 * Version: 1.0.4
 * Author: You
 */

if (!defined('ABSPATH')) exit;

add_action('admin_menu', function() {
    add_menu_page(
        'Triage WP',
        'Triage WP',
        'edit_posts',
        'wp-triage',
        'wp_triage_render_page',
        'dashicons-visibility',
        30
    );
});

add_action('admin_enqueue_scripts', function($hook) {
    if ($hook !== 'toplevel_page_wp-triage') return;

    // Material Symbols font for icons
    wp_enqueue_style('material-symbols', 'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20,300,0,0&display=swap', [], null);

    // React app built assets
    wp_enqueue_style('wp-triage', plugin_dir_url(__FILE__) . 'dist/wp-triage.css', ['material-symbols'], '2.26.0');
    wp_enqueue_script('wp-triage', plugin_dir_url(__FILE__) . 'dist/wp-triage.js', [], '2.26.0', true);

    // Pass WordPress data to the React app
    wp_localize_script('wp-triage', 'wpTriage', [
        'ajaxUrl' => admin_url('admin-ajax.php'),
        'nonce' => wp_create_nonce('wp_triage_nonce'),
    ]);
});

add_action('wp_ajax_wp_triage_get_post_types', function() {
    check_ajax_referer('wp_triage_nonce', 'nonce');
    global $wpdb;

    $types = get_post_types(['public' => true], 'objects');
    $result = [];

    foreach ($types as $type) {
        if ($type->name === 'attachment') continue;

        // Total posts in this type
        $total = wp_count_posts($type->name)->publish + wp_count_posts($type->name)->draft + wp_count_posts($type->name)->pending + wp_count_posts($type->name)->private;

        // Count triaged posts in this type
        $triaged = $wpdb->get_var($wpdb->prepare("
            SELECT COUNT(DISTINCT p.ID)
            FROM {$wpdb->posts} p
            INNER JOIN {$wpdb->postmeta} pm ON p.ID = pm.post_id AND pm.meta_key = '_wp_triage'
            WHERE p.post_type = %s
            AND p.post_status IN ('publish', 'draft', 'pending', 'private')
        ", $type->name));

        $result[] = [
            'name' => $type->name,
            'label' => $type->label,
            'count' => (int) $total,
            'triaged' => (int) $triaged,
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
        // Get triage status from post meta
        $triage_meta = get_post_meta($p->ID, '_wp_triage', true);
        $triage_status = null;
        if ($triage_meta) {
            $triage_data = json_decode($triage_meta, true);
            $triage_status = $triage_data['status'] ?? null;
        }

        $result[] = [
            'id' => $p->ID,
            'title' => $p->post_title ?: '(no title)',
            'status' => $p->post_status,
            'triage_status' => $triage_status,
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

// Mark a post as triaged (keep or unpublish)
add_action('wp_ajax_wp_triage_mark', function() {
    check_ajax_referer('wp_triage_nonce', 'nonce');
    $post_id = intval($_POST['post_id'] ?? 0);
    $status = sanitize_key($_POST['status'] ?? '');

    $post = get_post($post_id);
    if (!$post) wp_send_json_error('Post not found');

    if (!in_array($status, ['keep', 'unpublish'])) {
        wp_send_json_error('Invalid triage status');
    }

    $triage_data = [
        'status' => $status,
        'timestamp' => time(),
        'user_id' => get_current_user_id(),
    ];

    update_post_meta($post_id, '_wp_triage', wp_json_encode($triage_data));

    wp_send_json_success([
        'post_id' => $post_id,
        'triage_status' => $status,
        'post_status' => $post->post_status,
    ]);
});

// Get traffic data from wp_options
add_action('wp_ajax_wp_triage_get_traffic', function() {
    check_ajax_referer('wp_triage_nonce', 'nonce');
    $stored = get_option('wp_triage_csv_data', null);
    if ($stored) {
        wp_send_json_success($stored);
    } else {
        wp_send_json_success(['headers' => [], 'data' => []]);
    }
});

// Save CSV data (parsed client-side)
add_action('wp_ajax_wp_triage_save_csv', function() {
    check_ajax_referer('wp_triage_nonce', 'nonce');

    if (!current_user_can('manage_options')) {
        wp_send_json_error('Permission denied');
    }

    $headers = isset($_POST['headers']) ? json_decode(stripslashes($_POST['headers']), true) : [];
    $data = isset($_POST['data']) ? json_decode(stripslashes($_POST['data']), true) : [];
    $raw_lines = isset($_POST['raw_lines']) ? json_decode(stripslashes($_POST['raw_lines']), true) : [];
    $filename = sanitize_file_name($_POST['filename'] ?? 'data.csv');
    $row_count = intval($_POST['row_count'] ?? 0);

    if (empty($headers) || empty($data)) {
        wp_send_json_error('Invalid CSV data');
    }

    $csv_data = [
        'headers' => $headers,
        'data' => $data,
        'raw_lines' => $raw_lines,
        'filename' => $filename,
        'uploaded_at' => time(),
        'row_count' => $row_count,
    ];

    update_option('wp_triage_csv_data', $csv_data, false);

    wp_send_json_success([
        'filename' => $filename,
        'row_count' => $row_count,
        'headers' => $headers,
    ]);
});

// Get CSV upload status
add_action('wp_ajax_wp_triage_get_csv_status', function() {
    check_ajax_referer('wp_triage_nonce', 'nonce');
    $stored = get_option('wp_triage_csv_data', null);
    if ($stored && isset($stored['filename'])) {
        wp_send_json_success([
            'has_csv' => true,
            'filename' => $stored['filename'],
            'row_count' => $stored['row_count'] ?? 0,
            'uploaded_at' => $stored['uploaded_at'] ?? null,
        ]);
    } else {
        wp_send_json_success(['has_csv' => false]);
    }
});

// Get all unpublished post slugs for CSV export
add_action('wp_ajax_wp_triage_get_unpublished_slugs', function() {
    check_ajax_referer('wp_triage_nonce', 'nonce');

    // Get all posts with unpublish triage status
    $posts = get_posts([
        'post_type' => 'any',
        'post_status' => ['publish', 'draft', 'pending', 'private'],
        'numberposts' => -1,
        'meta_query' => [
            [
                'key' => '_wp_triage',
                'compare' => 'EXISTS',
            ],
        ],
    ]);

    $unpublished_slugs = [];
    foreach ($posts as $post) {
        $triage_meta = get_post_meta($post->ID, '_wp_triage', true);
        if ($triage_meta) {
            $triage_data = json_decode($triage_meta, true);
            if (isset($triage_data['status']) && $triage_data['status'] === 'unpublish') {
                // Use post_name (slug) directly - more reliable than parsing permalink
                // which returns query strings like ?p=123 for drafts
                $slug = $post->post_name;
                if (!empty($slug)) {
                    $unpublished_slugs[] = $slug;
                }
            }
        }
    }

    wp_send_json_success($unpublished_slugs);
});

// Clear all triage data
add_action('wp_ajax_wp_triage_clear_all_data', function() {
    check_ajax_referer('wp_triage_nonce', 'nonce');

    if (!current_user_can('manage_options')) {
        wp_send_json_error('Permission denied');
    }

    global $wpdb;

    // Delete all triage meta from postmeta table
    $deleted_meta = $wpdb->query("DELETE FROM {$wpdb->postmeta} WHERE meta_key = '_wp_triage'");

    // Delete CSV data from options
    delete_option('wp_triage_csv_data');

    wp_send_json_success([
        'deleted_meta_rows' => $deleted_meta,
        'message' => 'All triage data cleared'
    ]);
});

// Add triage status filter dropdown to post list screens
add_action('restrict_manage_posts', function($post_type) {
    global $wpdb;

    // Check if any posts have triage status for this post type
    $has_triage = $wpdb->get_var($wpdb->prepare(
        "SELECT COUNT(*) FROM {$wpdb->postmeta} pm
         INNER JOIN {$wpdb->posts} p ON pm.post_id = p.ID
         WHERE pm.meta_key = '_wp_triage' AND p.post_type = %s",
        $post_type
    ));

    if (!$has_triage) return;

    $selected = isset($_GET['wp_triage_filter']) ? sanitize_text_field($_GET['wp_triage_filter']) : '';
    ?>
    <select name="wp_triage_filter">
        <option value="">Triage Status</option>
        <option value="keep" <?php selected($selected, 'keep'); ?>>Keep</option>
        <option value="unpublish" <?php selected($selected, 'unpublish'); ?>>Unpublish</option>
    </select>
    <?php
});

// Filter posts by triage status when filter is selected
add_action('pre_get_posts', function($query) {
    if (!is_admin() || !$query->is_main_query()) return;

    global $pagenow;
    if ($pagenow !== 'edit.php') return;

    $filter = isset($_GET['wp_triage_filter']) ? sanitize_text_field($_GET['wp_triage_filter']) : '';
    if (!in_array($filter, ['keep', 'unpublish'])) return;

    // Meta query to find posts with matching triage status
    $meta_query = $query->get('meta_query') ?: [];
    $meta_query[] = [
        'key' => '_wp_triage',
        'value' => '"status":"' . $filter . '"',
        'compare' => 'LIKE'
    ];
    $query->set('meta_query', $meta_query);
});

function wp_triage_render_page() {
    // React app mounts to this element - all UI is rendered by React
    echo '<div class="wrap" id="wp-triage-app"></div>';
}
