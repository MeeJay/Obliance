// =============================================================================
// Obliance RMM — Socket.io Event Definitions
// =============================================================================

// Server → Client events
export const SocketEvents = {
  // Device events
  DEVICE_UPDATED:         'DEVICE_UPDATED',         // device status or metadata changed
  DEVICE_METRICS_PUSHED:  'DEVICE_METRICS_PUSHED',  // agent pushed new metrics
  DEVICE_APPROVED:        'DEVICE_APPROVED',         // device was approved
  DEVICE_DELETED:         'DEVICE_DELETED',          // device was removed
  DEVICE_ONLINE:          'DEVICE_ONLINE',            // device came online
  DEVICE_OFFLINE:         'DEVICE_OFFLINE',           // device went offline

  // Command events
  COMMAND_UPDATED:        'COMMAND_UPDATED',          // command status changed
  COMMAND_RESULT:         'COMMAND_RESULT',           // command finished with result

  // Script execution events
  EXECUTION_UPDATED:      'EXECUTION_UPDATED',        // execution status changed
  EXECUTION_OUTPUT:       'EXECUTION_OUTPUT',         // real-time stdout/stderr chunk

  // Update events
  UPDATE_STATUS_CHANGED:  'UPDATE_STATUS_CHANGED',    // device update status changed
  UPDATE_SCAN_COMPLETE:   'UPDATE_SCAN_COMPLETE',     // scan finished, new updates found

  // Compliance events
  COMPLIANCE_RESULT:      'COMPLIANCE_RESULT',        // compliance check completed
  COMPLIANCE_SCORE_CHANGED: 'COMPLIANCE_SCORE_CHANGED',

  // Remote access events
  REMOTE_SESSION_UPDATED: 'REMOTE_SESSION_UPDATED',  // session status changed
  REMOTE_TUNNEL_READY:    'REMOTE_TUNNEL_READY',     // agent connected, tunnel open

  // Group events
  GROUP_CREATED:          'GROUP_CREATED',
  GROUP_UPDATED:          'GROUP_UPDATED',
  GROUP_DELETED:          'GROUP_DELETED',
  GROUP_MOVED:            'GROUP_MOVED',

  // Notification & alert events
  NOTIFICATION_SENT:      'NOTIFICATION_SENT',
  NOTIFICATION_NEW:       'NOTIFICATION_NEW',         // live alert created

  // Settings
  SETTINGS_UPDATED:       'SETTINGS_UPDATED',

  // Maintenance
  MAINTENANCE_CHANGED:    'MAINTENANCE_CHANGED',

  // Client → Server
  DEVICE_SUBSCRIBE:       'DEVICE_SUBSCRIBE',
  DEVICE_UNSUBSCRIBE:     'DEVICE_UNSUBSCRIBE',
} as const;

export type SocketEvent = typeof SocketEvents[keyof typeof SocketEvents];
