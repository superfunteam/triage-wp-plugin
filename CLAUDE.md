# Triage WP - Development Guide

Point your AI agent here to get started!

## Project Overview

Triage WP is a WordPress plugin for quickly reviewing and bulk-managing content. Built with React + Tailwind CSS, compiled to a single JS/CSS bundle.

## Tech Stack

- **Backend**: WordPress PHP plugin (`wp-triage.php`)
- **Frontend**: React 19 + TypeScript + Tailwind CSS v4 + Radix UI
- **Build**: Vite
- **UI Components**: Shadcn-style components in `admin-ui/src/components/ui/`

## File Structure

```
wp-triage/
├── wp-triage.php          # Main plugin file (PHP endpoints, admin menu)
├── uninstall.php          # Cleanup on plugin deletion
├── dist/                  # Built assets (DO NOT EDIT)
│   ├── wp-triage.js
│   └── wp-triage.css
├── admin-ui/              # React source
│   ├── src/
│   │   ├── App.tsx        # Main application component
│   │   ├── index.css      # Tailwind + custom styles
│   │   └── components/ui/ # Shadcn-style components
│   ├── package.json
│   └── vite.config.ts
└── docs/                  # Design docs and PRDs
```

## Development Workflow

```bash
cd admin-ui
npm install
npm run build  # Builds to ../dist/
```

Always rebuild after React/CSS changes. PHP changes take effect immediately.

## Key Files to Know

| File | Purpose |
|------|---------|
| `wp-triage.php` | All PHP: AJAX endpoints, admin menu, asset loading |
| `admin-ui/src/App.tsx` | Main React app - all UI logic |
| `admin-ui/src/index.css` | Tailwind config + custom animations |
| `admin-ui/src/components/ui/` | Reusable UI components |

## AJAX Endpoints

All endpoints use WordPress AJAX with nonce verification.

| Endpoint | Purpose |
|----------|---------|
| `wp_triage_get_types` | Get post types with counts |
| `wp_triage_get_posts` | Get posts for a post type |
| `wp_triage_get_post_meta` | Get full post details |
| `wp_triage_mark` | Mark post as keep/unpublish |
| `wp_triage_unpublish` | Change post to draft |
| `wp_triage_get_traffic` | Get uploaded CSV data |
| `wp_triage_save_csv` | Store CSV data |
| `wp_triage_get_unpublished_slugs` | Get slugs of unpublished posts |
| `wp_triage_clear_all_data` | Reset all triage data |

## Data Storage

- **Triage status**: Post meta `_wp_triage` (JSON with status, timestamp, user_id)
- **CSV data**: WordPress option `wp_triage_csv_data`

## UI Patterns

- Dialogs use Radix UI via `@/components/ui/dialog`
- Buttons, badges, cards follow Shadcn patterns
- Use `cn()` utility for conditional classNames
- Tailwind v4 with CSS variables for theming

## Common Tasks

### Add a new AJAX endpoint

1. Add handler in `wp-triage.php`:
```php
add_action('wp_ajax_wp_triage_my_action', function() {
    check_ajax_referer('wp_triage_nonce', 'nonce');
    // Your logic here
    wp_send_json_success($data);
});
```

2. Call from React:
```typescript
ajax('wp_triage_my_action', { param: value }).then(res => {
    if (res.success) { /* handle res.data */ }
});
```

### Add a new UI component

1. Create in `admin-ui/src/components/ui/`
2. Follow existing patterns (forwardRef, cn utility, variants)
3. Export from the file

### Modify styles

- Global styles: `admin-ui/src/index.css`
- Component styles: Tailwind classes in JSX
- Theme colors: CSS variables in `@theme` block

## Version

Current: 1.0.6

Ask before bumping the version number.

## Testing

1. Clear triage data: Settings > Permissions > "Clear all Triage data"
2. Test with different post types
3. Test CSV upload/download cycle
4. Verify keyboard shortcuts work

## Tips

- The `dist/` folder is gitignored output - always rebuild
- Debug React state with browser DevTools
- Check browser console for AJAX errors
- WordPress admin styles can interfere - use `#wp-triage-app` scoping
