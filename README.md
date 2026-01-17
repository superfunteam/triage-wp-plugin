# Triage WP

A WordPress plugin for quickly reviewing and unpublishing content, one post at a time.

## Quick Start

1. Install the plugin in your WordPress `wp-content/plugins/` directory
2. Activate "Triage WP" in WordPress admin
3. Navigate to **Tools > Triage WP**
4. Select a post type and start triaging!

## For AI Agents

Point your agent to the `CLAUDE.md` file for development instructions:

```
Read CLAUDE.md for project context and development guidelines.
```

## Features

- **Fast triage workflow** - Review posts one at a time with keyboard shortcuts
- **Keep or Unpublish** - Two-button workflow: keep published or mark as draft
- **CSV import** - Upload analytics data to see traffic metrics alongside posts
- **CSV export** - Download your triage decisions with `[UNPUBLISH]` markers
- **Progress tracking** - See how many posts you've reviewed per content type
- **Preview panel** - See the live post while making decisions
- **Bulk actions** - Select multiple posts for batch operations

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Keep current post |
| `Delete` / `Backspace` | Unpublish current post |
| `↑` / `↓` | Navigate posts |
| `←` / `→` | Switch post types |
| `Escape` | Close modals |

## How It Works

1. **Select a post type** from the sidebar (Pages, Posts, etc.)
2. **Review** the post details and live preview
3. **Decide**: Press `Space` to keep, or `Delete` to unpublish
4. **Repeat** until all posts are triaged

Triage decisions are stored as post meta (`_wp_triage`) so they persist across sessions and devices.

## CSV Features

### Import
Upload a CSV with URL slugs in the first column to see traffic/analytics data alongside each post. Additional columns become metadata displayed in the post details panel.

### Export
Download your triaged CSV with `[UNPUBLISH]` prefix on URLs you've marked for unpublishing. Perfect for sharing decisions with your team.

## Requirements

- WordPress 5.0+
- PHP 7.4+

## Development

See `CLAUDE.md` for development setup and guidelines.

```bash
cd admin-ui
npm install
npm run dev    # Development server
npm run build  # Production build to dist/
```

## License

MIT
