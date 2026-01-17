# PRD: Triage Status Tracking System

## Problem Statement

Currently, the plugin has two separate concepts that are conflated:

1. **Triage Decision** - Has the user reviewed this post and made a decision?
2. **Post Status** - Is the post published, draft, etc.?

The current implementation:
- "Keep" adds post ID to a `kept` Set stored in localStorage (client-side only)
- "Unpublish" immediately changes the post to draft status
- Counts are calculated from: `totalPosts - kept.size`

### Issues with Current Approach

1. **Lost on browser clear** - The `kept` Set is in localStorage, so clearing browser data loses all triage progress
2. **Draft ambiguity** - A draft post could be:
   - A post that was always a draft (not yet reviewed)
   - A post we triaged and decided to unpublish
   - A post the user manually set to draft for other reasons
3. **Count reliability** - Counts depend on client-side state that can get out of sync
4. **Multi-device/user** - Progress doesn't sync between browsers or users
5. **No audit trail** - We can't see when a post was triaged or by whom

## Proposed Solution

Introduce a **Triage Status** system stored server-side that tracks the review decision separately from post status.

### Triage States

| State | Meaning |
|-------|---------|
| `null` / unset | Post has NOT been reviewed yet |
| `keep` | Reviewed, decision: KEEP published |
| `unpublish` | Reviewed, decision: UNPUBLISH (may or may not be actually unpublished yet) |

### Storage Options Analysis

#### Option A: Post Meta (per-post)
```php
update_post_meta($post_id, '_wp_triage_status', 'keep');
update_post_meta($post_id, '_wp_triage_timestamp', time());
update_post_meta($post_id, '_wp_triage_user', get_current_user_id());
```

**Pros:**
- Standard WordPress pattern
- Data lives with the post
- Survives post export/import
- Easy to query with WP_Query

**Cons:**
- Adds rows to postmeta table (3 rows per triaged post)
- Slightly more DB queries

#### Option B: Single Option (serialized array)
```php
$triage_data = get_option('wp_triage_decisions', []);
$triage_data[$post_id] = [
  'status' => 'keep',
  'timestamp' => time(),
  'user' => get_current_user_id()
];
update_option('wp_triage_decisions', $triage_data);
```

**Pros:**
- Single DB row
- Fast reads (one query gets all data)
- Completely isolated from post tables

**Cons:**
- Large serialized array with hundreds of posts
- Can't easily query "all kept posts" via WP_Query
- Autoload could be slow if data grows large
- Lost on option reset

#### Option C: Custom Table
```sql
CREATE TABLE wp_triage_decisions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  post_id BIGINT NOT NULL,
  status VARCHAR(20) NOT NULL,
  user_id BIGINT,
  created_at DATETIME,
  UNIQUE KEY post_id (post_id)
);
```

**Pros:**
- Clean, normalized storage
- Efficient queries
- Can index on status for fast filtering

**Cons:**
- Requires table creation on activation
- More complex plugin architecture
- Cleanup on uninstall

### Recommendation: Option A (Post Meta)

Post meta is the WordPress-idiomatic approach and handles our scale (hundreds of posts) easily. The postmeta table is optimized for this exact use case.

**Single meta key approach** (even simpler):
```php
// Store as JSON in single meta key
update_post_meta($post_id, '_wp_triage', json_encode([
  'status' => 'keep',
  'timestamp' => time(),
  'user' => get_current_user_id()
]));
```

This gives us:
- 1 meta row per triaged post (not 3)
- All data in one place
- Easy to extend later

## Data Model

### Meta Key: `_wp_triage`

```json
{
  "status": "keep" | "unpublish",
  "timestamp": 1705123456,
  "user_id": 1
}
```

### API Endpoints

#### Mark Post as Triaged
```
POST wp_ajax_wp_triage_mark
{
  post_id: 123,
  status: "keep" | "unpublish"
}
```

Response:
```json
{
  "success": true,
  "data": {
    "post_id": 123,
    "triage_status": "keep",
    "post_status": "publish"
  }
}
```

#### Get Triage Status for Posts
```
POST wp_ajax_wp_triage_get_statuses
{
  post_ids: [123, 456, 789]
}
```

Response:
```json
{
  "success": true,
  "data": {
    "123": { "status": "keep", "timestamp": 1705123456 },
    "456": { "status": "unpublish", "timestamp": 1705123500 },
    "789": null
  }
}
```

#### Clear Triage Status
```
POST wp_ajax_wp_triage_clear
{
  post_id: 123
}
```

## UI/UX Changes

### Count Calculation (NEW)

```
Remaining = Total Posts - Posts with triage status (keep OR unpublish)
```

This is now server-authoritative, not client-state dependent.

### Action Button Behavior

| Button | Current Behavior | New Behavior |
|--------|-----------------|--------------|
| **Keep** | Add to localStorage Set | Mark as `keep` in post meta, advance to next |
| **Unpublish** | Change post to draft immediately | Mark as `unpublish` in post meta, advance to next |

### New: "Apply Changes" Flow (Optional Enhancement)

Could add a confirmation step:
1. User marks posts as keep/unpublish during triage session
2. At end, shows summary: "5 posts marked to unpublish"
3. User clicks "Apply" to actually change post statuses

**For v1:** Keep immediate unpublish behavior, but ALSO record the triage status.

### Visual Indicators in Post List

| Triage Status | Visual Treatment |
|---------------|------------------|
| Not reviewed | Normal appearance |
| `keep` | Checkmark icon, green tint, strikethrough |
| `unpublish` | X icon, orange tint, strikethrough |

### Filtering (Future Enhancement)

Could add filter buttons:
- "All" - Show all posts
- "Unreviewed" - Only posts without triage status
- "Kept" - Posts marked keep
- "Unpublished" - Posts marked unpublish

## Migration

### From localStorage to Post Meta

On first load after update:
1. Read `wp_triage_kept` from localStorage
2. For each post ID, check if already has `_wp_triage` meta
3. If not, migrate: set status to `keep`
4. Clear localStorage after successful migration
5. Show toast: "Migrated X triage decisions to server"

## Performance Considerations

### Bulk Loading
When loading posts list, fetch triage status in single query:
```php
$post_ids = array_column($posts, 'ID');
$meta_query = $wpdb->prepare(
  "SELECT post_id, meta_value FROM $wpdb->postmeta
   WHERE meta_key = '_wp_triage' AND post_id IN (" . implode(',', $post_ids) . ")"
);
```

### Count Query
```php
// Count posts WITHOUT triage meta (unreviewed)
$unreviewed = $wpdb->get_var("
  SELECT COUNT(*) FROM $wpdb->posts p
  LEFT JOIN $wpdb->postmeta pm ON p.ID = pm.post_id AND pm.meta_key = '_wp_triage'
  WHERE p.post_type = %s
  AND p.post_status IN ('publish', 'draft', 'pending', 'private')
  AND pm.meta_value IS NULL
", $post_type);
```

Or simpler - count triaged, subtract from total:
```php
$triaged_count = $wpdb->get_var("
  SELECT COUNT(*) FROM $wpdb->postmeta
  WHERE meta_key = '_wp_triage'
");
$remaining = $total_posts - $triaged_count;
```

## Uninstall / Cleanup

On plugin deactivation (optional) or uninstall:
```php
// Remove all triage meta
$wpdb->query("DELETE FROM $wpdb->postmeta WHERE meta_key = '_wp_triage'");
```

User should be warned before this action.

## Implementation Phases

### Phase 1: Backend Infrastructure
- [ ] Add `wp_triage_mark` AJAX endpoint
- [ ] Add `wp_triage_get_statuses` AJAX endpoint
- [ ] Add `wp_triage_clear` AJAX endpoint
- [ ] Modify `wp_triage_get_posts` to include triage status

### Phase 2: Frontend Integration
- [ ] Create `useTriageStatus` hook or integrate into existing state
- [ ] Update `keep()` function to call mark endpoint
- [ ] Update `unpublish()` function to call mark endpoint (AND unpublish)
- [ ] Update count calculations to use server data

### Phase 3: Migration
- [ ] Add migration logic for localStorage data
- [ ] Add migration status indicator
- [ ] Clear localStorage after migration

### Phase 4: UI Polish
- [ ] Add visual indicators for triage status in post list
- [ ] Update strikethrough styling to differentiate keep vs unpublish
- [ ] Ensure animations work with new count source

## Questions to Resolve

1. **Should "Unpublish" immediately change post status, or just mark for later?**
   - Recommendation: Keep immediate behavior, but also record the decision

2. **Should we track "unmarking" a post (removing triage status)?**
   - Could add a "Reset" action to clear triage status

3. **Multi-user support?**
   - Current design tracks who made the decision
   - Could show "Triaged by [User]" in UI

4. **Should triage status survive post restore from trash?**
   - Post meta survives trash/restore, so yes automatically

## Success Criteria

1. **Reliability**: Counts are always accurate, derived from server state
2. **Persistence**: Triage progress survives browser clear, device switch
3. **Performance**: No noticeable slowdown with 500+ posts
4. **Safety**: Zero impact on core WordPress post data beyond meta
5. **Reversibility**: Can clear all triage data without affecting posts
