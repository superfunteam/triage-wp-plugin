<?php
/**
 * Uninstall script for Triage WP
 *
 * Runs when the plugin is deleted from WordPress.
 * Cleans up all triage data stored in post meta.
 */

// Exit if not called by WordPress
if (!defined('WP_UNINSTALL_PLUGIN')) {
    exit;
}

global $wpdb;

// Delete all triage meta from postmeta table
// Uses our namespaced meta key to ensure we only delete our data
$wpdb->query("DELETE FROM {$wpdb->postmeta} WHERE meta_key = '_wp_triage'");
