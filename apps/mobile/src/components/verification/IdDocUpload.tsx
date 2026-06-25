/**
 * IdDocUpload — the government-ID upload action (OH-184, AC: ID upload via
 * signed URL). Flow:
 *   1. pick a file (expo-document-picker; image or PDF)
 *   2. mint a one-time signed upload URL (POST /v1/uploads/signed-url)
 *   3. PUT the bytes straight to the private Supabase Storage bucket
 *      (uploadToSignedUrl — the anon client never sees the service-role key)
 *   4. confirm the objectPath (POST /v1/providers/me/verification/id-doc)
 *
 * The browser exposes a real File on the picked asset; native gives a uri we
 * read into an ArrayBuffer. Either is an accepted uploadToSignedUrl body.
 */
import * as DocumentPicker from 'expo-document-picker';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { ApiError, recordIdDoc, requestUploadUrl, type Verification } from '@/api/client';
import { supabase } from '@/auth/supabase';
import { Icon } from '@/components/Icon';
import { colors, fonts, radii } from '@/theme/tokens';

async function fileBody(asset: DocumentPicker.DocumentPickerAsset): Promise<Blob | ArrayBuffer> {
  // Web: the picker hands back a real File. Native: read the cache uri into bytes.
  if (Platform.OS === 'web' && asset.file) return asset.file;
  const res = await fetch(asset.uri);
  return res.arrayBuffer();
}

export function IdDocUpload({ onUploaded }: { onUploaded: (v: Verification) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickAndUpload = async () => {
    setError(null);
    let picked: DocumentPicker.DocumentPickerResult;
    try {
      picked = await DocumentPicker.getDocumentAsync({
        type: ['image/*', 'application/pdf'],
        copyToCacheDirectory: true,
        multiple: false,
      });
    } catch {
      setError("Couldn't open the file picker. Please try again.");
      return;
    }
    if (picked.canceled || !picked.assets?.length) return;
    const asset = picked.assets[0];

    setBusy(true);
    try {
      const { bucket, objectPath, token } = await requestUploadUrl('id-doc');
      const body = await fileBody(asset);
      const { error: upErr } = await supabase.storage
        .from(bucket)
        .uploadToSignedUrl(objectPath, token, body, { contentType: asset.mimeType });
      if (upErr) throw new Error(upErr.message);
      const v = await recordIdDoc(objectPath);
      onUploaded(v);
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 0
          ? 'Set EXPO_PUBLIC_API_URL to reach the backend.'
          : e instanceof Error
            ? e.message
            : "Upload failed. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={pickAndUpload}
        style={({ pressed }) => [styles.btn, { opacity: busy ? 0.6 : pressed ? 0.85 : 1 }]}
      >
        <Icon name="arrow-up-right" size={16} color={colors.brand} strokeWidth={2} />
        <Text style={styles.btnText}>{busy ? 'Uploading…' : 'Choose file'}</Text>
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 46,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: colors.brand,
    backgroundColor: colors.brandSoft,
  },
  btnText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.brand },
  error: { fontFamily: fonts.medium, fontSize: 12, color: colors.danger, marginTop: 8 },
});
