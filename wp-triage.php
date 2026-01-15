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

    // Material Symbols font for icons
    wp_enqueue_style('material-symbols', 'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20,300,0,0&display=swap', [], null);

    // React app built assets
    wp_enqueue_style('wp-triage', plugin_dir_url(__FILE__) . 'dist/wp-triage.css', ['material-symbols'], '2.0.0');
    wp_enqueue_script('wp-triage', plugin_dir_url(__FILE__) . 'dist/wp-triage.js', [], '2.0.0', true);

    // Pass WordPress data to the React app
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
    // React app mounts to this element - all UI is rendered by React
    echo '<div class="wrap" id="wp-triage-app"></div>';
}
