/**
 * CallRoom (native, OH-216) — the full-screen embedded Daily.co room with our own
 * controls (ADR-0008 "native embedded video … inside the app"). Uses the Daily
 * React Native SDK (WebRTC) — requires a development build, not Expo Go (the
 * @config-plugins/react-native-webrtc plugin adds the native module + camera/mic
 * permissions). The web room is the sibling CallRoom.web.tsx (Daily iframe).
 *
 * We join a PRIVATE room with the per-user meeting token minted by the Edge
 * (POST /v1/calls/{id}/join). 1:1 layout: the counterparty fills the screen, the
 * local camera is a corner PiP; a bottom bar toggles mic/camera and leaves.
 */
// Polyfill crypto.getRandomValues before the Daily SDK loads (its peer dep on
// native; a no-op-ish import with side effects — must precede the Daily import).
import 'react-native-get-random-values';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Daily, {
  DailyMediaView,
  type DailyCall,
  type DailyParticipant,
} from '@daily-co/react-native-daily-js';

import { IconButton } from '@/components/ui/IconButton';
import { colors, fonts } from '@/theme/tokens';

export interface CallRoomProps {
  roomUrl: string;
  token: string;
  onLeave: () => void;
}

export function CallRoom({ roomUrl, token, onLeave }: CallRoomProps) {
  const callRef = useRef<DailyCall | null>(null);
  const [participants, setParticipants] = useState<Record<string, DailyParticipant>>({});
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const call = Daily.createCallObject();
    callRef.current = call;
    const sync = () => setParticipants({ ...call.participants() });
    call
      .on('joined-meeting', () => {
        setJoined(true);
        sync();
      })
      .on('participant-joined', sync)
      .on('participant-updated', sync)
      .on('participant-left', sync)
      .on('error', (ev) => setError(ev?.errorMsg ?? 'The call ran into a problem.'));
    call.join({ url: roomUrl, token }).catch((e: unknown) => {
      setError(e instanceof Error ? e.message : 'Could not join the call.');
    });
    return () => {
      call.leave().catch(() => {});
      call.destroy().catch(() => {});
      callRef.current = null;
    };
  }, [roomUrl, token]);

  const toggleMic = () => {
    const next = !micOn;
    setMicOn(next);
    callRef.current?.setLocalAudio(next);
  };
  const toggleCam = () => {
    const next = !camOn;
    setCamOn(next);
    callRef.current?.setLocalVideo(next);
  };
  const leave = () => {
    callRef.current?.leave().catch(() => {});
    onLeave();
  };

  const local = participants.local;
  const remote = Object.values(participants).find((p) => p && !p.local);

  return (
    <View style={styles.root}>
      <View style={styles.remote}>
        {remote?.videoTrack ? (
          <DailyMediaView
            videoTrack={remote.videoTrack}
            audioTrack={remote.audioTrack || null}
            objectFit="cover"
            style={styles.fill}
          />
        ) : (
          <View style={styles.waiting}>
            {error ? (
              <Text style={styles.waitText}>{error}</Text>
            ) : (
              <>
                <ActivityIndicator color={colors.inkInv} />
                <Text style={styles.waitText}>{joined ? 'Waiting for the other person…' : 'Connecting…'}</Text>
              </>
            )}
          </View>
        )}
      </View>

      {local?.videoTrack && camOn ? (
        <View style={styles.pip}>
          <DailyMediaView videoTrack={local.videoTrack} audioTrack={null} mirror objectFit="cover" style={styles.fill} />
        </View>
      ) : null}

      <View style={styles.controls}>
        <IconButton name={micOn ? 'mic' : 'mic-off'} dark accessibilityLabel={micOn ? 'Mute' : 'Unmute'} onPress={toggleMic} />
        <IconButton
          name={camOn ? 'camera' : 'camera-off'}
          dark
          accessibilityLabel={camOn ? 'Turn camera off' : 'Turn camera on'}
          onPress={toggleCam}
        />
        <IconButton name="phone-off" accessibilityLabel="Leave call" onPress={leave} style={styles.leave} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ink },
  remote: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  fill: { width: '100%', height: '100%' },
  waiting: { alignItems: 'center', gap: 12, padding: 24 },
  waitText: { fontFamily: fonts.medium, fontSize: 14, color: colors.inkInv, textAlign: 'center' },
  pip: {
    position: 'absolute',
    top: 24,
    right: 16,
    width: 108,
    height: 150,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: colors.ink2,
  },
  controls: {
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 20,
  },
  leave: { backgroundColor: colors.danger },
});
