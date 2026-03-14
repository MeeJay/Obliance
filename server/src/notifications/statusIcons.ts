/**
 * Shared status icon/color helpers used across notification plugins.
 */

/** Emoji icon for each monitor status */
export function statusIcon(status: string): string {
  switch (status) {
    case 'up':           return '✅';
    case 'down':         return '🔴';
    case 'alert':        return '🟠';
    case 'ssl_warning':  return '⚠️';
    case 'ssl_expired':  return '🔴';
    case 'inactive':     return '⚫';
    case 'value_changed':return '🔄';
    case 'paused':       return '⏸️';
    case 'pending':      return '🔵';
    case 'maintenance':  return '🔧';
    default:             return '❓';
  }
}

/** Hex colour for Discord embeds */
export const STATUS_COLORS_HEX: Record<string, number> = {
  up:            0x2ecc71,
  down:          0xe74c3c,
  alert:         0xe67e22, // orange
  ssl_warning:   0xf39c12,
  ssl_expired:   0xe74c3c,
  inactive:      0x95a5a6,
  value_changed: 0x3498db,
  pending:       0xf39c12,
  maintenance:   0x3498db,
  paused:        0x95a5a6,
};

/** CSS hex colour string for Slack attachments */
export const STATUS_COLORS_CSS: Record<string, string> = {
  up:            '#2ecc71',
  down:          '#e74c3c',
  alert:         '#e67e22',
  ssl_warning:   '#f39c12',
  ssl_expired:   '#e74c3c',
  inactive:      '#95a5a6',
  value_changed: '#3498db',
  pending:       '#f39c12',
  maintenance:   '#3498db',
  paused:        '#95a5a6',
};
