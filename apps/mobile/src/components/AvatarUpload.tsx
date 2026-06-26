/**
 * AvatarUpload — the profile-photo picker shared by the Caregiver onboarding
 * wizard (web) and the profile builder (native). Mirrors IdDocUpload's flow but
 * targets the PUBLIC `avatars` bucket and confirms the object straight onto the
 * profile:
 *   1. pick an image (expo-document-picker)
 *   2. mint a one-time signed upload URL (POST /v1/uploads/signed-url, kind avatar)
 *   3. PUT the bytes to the public avatars bucket (uploadToSignedUrl)
 *   4. PATCH the profile with the confirmed photoObjectPath → server returns the
 *      updated profile (incl. the derived public photoUrl)
 *
 * Cross-platform: web hands back a real File, native a uri we read into bytes.
 */
import * as DocumentPicker from 'expo-document-picker';
import { useState } from 'react';
import { Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { ApiError, patchCaregiverProfile, requestUploadUrl, type CaregiverProfile } from '@/api/client';
import { supabase } from '@/auth/supabase';
import { Icon } from '@/components/Icon';
import { colors, fonts, radii } from '@/theme/tokens';

async function fileBody(asset: DocumentPicker.DocumentPickerAsset): Promise<Blob | ArrayBuffer> {
  if (Platform.OS === 'web' && asset.file) return asset.file;
  const res = await fetch(asset.uri);
  return res.arrayBuffer();
}

export function AvatarUpload({
  photoUrl,
  initials,
  size = 92,
  onUploaded,
}: {
  photoUrl: string | null;
  initials: string;
  size?: number;
  onUploaded: (profile: CaregiverProfile) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickAndUpload = async () => {
    setError(null);
    let picked: DocumentPicker.DocumentPickerResult;
    try {
      picked = await DocumentPicker.getDocumentAsync({ type: ['image/*'], copyToCacheDirectory: true, multiple: false });
    } catch {
      setError("Couldn't open the file picker. Please try again.");
      return;
    }
    if (picked.canceled || !picked.assets?.length) return;
    const asset = picked.assets[0];

    setBusy(true);
    try {
      const { bucket, objectPath, token } = await requestUploadUrl('avatar');
      const body = await fileBody(asset);
      const { error: upErr } = await supabase.storage
        .from(bucket)
        .uploadToSignedUrl(objectPath, token, body, { contentType: asset.mimeType });
      if (upErr) throw new Error(upErr.message);
      const updated = await patchCaregiverProfile({ photoObjectPath: objectPath });
      onUploaded(updated);
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 0
          ? 'Set EXPO_PUBLIC_API_URL to reach the backend.'
          : e instanceof Error
            ? e.message
            : 'Upload failed. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  const radius = Math.round(size * 0.24);

  return (
    <View style={styles.row}>
      <View style={[styles.frame, { width: size, height: size, borderRadius: radius }]}>
        {photoUrl ? (
          <Image source={{ uri: photoUrl }} style={{ width: size, height: size, borderRadius: radius }} resizeMode="cover" />
        ) : (
          <Text style={[styles.initials, { fontSize: Math.round(size * 0.33) }]}>{initials}</Text>
        )}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.title}>Profile photo</Text>
        <Text style={styles.help}>A friendly, well-lit headshot raises your reply rate. JPG or PNG.</Text>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={pickAndUpload}
          style={({ pressed }) => [styles.btn, { opacity: busy ? 0.6 : pressed ? 0.85 : 1 }]}
        >
          <Icon name={photoUrl ? 'edit' : 'arrow-up-right'} size={14} color={colors.ink} strokeWidth={2} />
          <Text style={styles.btnText}>{busy ? 'Uploading…' : photoUrl ? 'Replace photo' : 'Upload photo'}</Text>
        </Pressable>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 18, alignItems: 'center' },
  frame: { backgroundColor: colors.catTutor, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  initials: { fontFamily: fonts.bold, color: colors.ink },
  title: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  help: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: colors.ink2, marginTop: 4, maxWidth: 380 },
  btn: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    height: 40,
    paddingHorizontal: 16,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
    marginTop: 12,
  },
  btnText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },
  error: { fontFamily: fonts.medium, fontSize: 12, color: colors.danger, marginTop: 8 },
});
