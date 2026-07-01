/**
 * VideoCallModal (OH-216) — the full-screen shell that hosts the embedded call.
 * Platform-agnostic: it presents a native Modal and mounts the platform-resolved
 * `CallRoom` (native SDK on iOS/Android, Daily iframe on web). The thread owns the
 * active session (room URL + token from start/join); closing leaves the call.
 */
import { Modal, StyleSheet, View } from 'react-native';

import { colors } from '@/theme/tokens';
import { CallRoom } from './CallRoom';

export interface VideoCallSessionState {
  callId: string;
  roomUrl: string;
  token: string;
}

export interface VideoCallModalProps {
  session: VideoCallSessionState | null;
  onClose: () => void;
}

export function VideoCallModal({ session, onClose }: VideoCallModalProps) {
  return (
    <Modal
      visible={session != null}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.root}>
        {session ? <CallRoom roomUrl={session.roomUrl} token={session.token} onLeave={onClose} /> : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ink },
});
