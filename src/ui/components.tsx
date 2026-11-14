import React from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View, ViewStyle, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { TAP, useTheme } from './theme';

export type IconName = React.ComponentProps<typeof Ionicons>['name'];

export function Btn({ label, onPress, icon, kind = 'primary', disabled, style }: {
  label: string; onPress: () => void; icon?: IconName; kind?: 'primary' | 'ghost' | 'danger'; disabled?: boolean; style?: ViewStyle;
}) {
  const t = useTheme();
  const bg = kind === 'primary' ? t.accent : kind === 'danger' ? t.danger : 'transparent';
  const fg = kind === 'ghost' ? t.accent : t.onAccent;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress}
      style={({ pressed }) => [{ minHeight: 52, borderRadius: 14, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.8 : 1, borderWidth: kind === 'ghost' ? 1.5 : 0, borderColor: t.accent }, style]}>
      {icon ? <Ionicons name={icon} size={22} color={fg} /> : null}
      <Text style={{ color: fg, fontSize: 17, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}

export function IconBtn({ icon, label, onPress, disabled, color, active }: { icon: IconName; label: string; onPress: () => void; disabled?: boolean; color?: string; active?: boolean }) {
  const t = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} hitSlop={4}
      style={({ pressed }) => ({ width: TAP, height: TAP, borderRadius: TAP / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? t.accent + '22' : pressed ? t.line : 'transparent', opacity: disabled ? 0.35 : 1 })}>
      <Ionicons name={icon} size={26} color={color ?? (active ? t.accent : t.text)} />
    </Pressable>
  );
}

export type BarItem = { key: string; icon: IconName; label: string; onPress: () => void; active?: boolean; disabled?: boolean };

/** Onderbalk: icoon + label, grote tikdoelen. */
export function BottomBar({ items }: { items: BarItem[] }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  return (
    <View style={{ flexDirection: 'row', backgroundColor: t.barBg, borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.line, paddingBottom: insets.bottom, paddingTop: 6 }}>
      {items.map((i) => (
        <Pressable key={i.key} accessibilityRole="button" accessibilityLabel={i.label} accessibilityState={{ selected: !!i.active, disabled: !!i.disabled }} disabled={i.disabled} onPress={i.onPress}
          style={{ flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center', gap: 2, opacity: i.disabled ? 0.35 : 1 }}>
          <Ionicons name={i.icon} size={25} color={i.active ? t.accent : t.sub} />
          <Text numberOfLines={1} style={{ fontSize: width < 420 ? 11 : 12, fontWeight: i.active ? '700' : '500', color: i.active ? t.accent : t.sub }}>{i.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function TopBar({ title, left, right }: { title: string; left?: React.ReactNode; right?: React.ReactNode }) {
  const t = useTheme();
  return (
    <SafeAreaView edges={['top']} style={{ backgroundColor: t.barBg }}>
      <View style={{ height: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: t.line }}>
        <View style={{ minWidth: TAP }}>{left}</View>
        <Text numberOfLines={1} accessibilityRole="header" style={{ flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', color: t.text }}>{title}</Text>
        <View style={{ minWidth: TAP, flexDirection: 'row', justifyContent: 'flex-end' }}>{right}</View>
      </View>
    </SafeAreaView>
  );
}

/** Onderste sheet voor korte keuzes en invoer. */
export function Sheet({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: '#0008' }} onPress={onClose} accessibilityLabel="Sluiten" />
      <View role="dialog" aria-modal aria-label={title} accessibilityViewIsModal style={{ backgroundColor: t.sheet, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 18, paddingBottom: 18 + insets.bottom, maxHeight: '85%', width: '100%', maxWidth: 560, alignSelf: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
          <Text accessibilityRole="header" style={{ flex: 1, fontSize: 20, fontWeight: '800', color: t.text }}>{title}</Text>
          <IconBtn icon="close" label="Sluiten" onPress={onClose} />
        </View>
        {children}
      </View>
    </Modal>
  );
}

export function Row({ icon, title, sub, onPress, onMore }: { icon: IconName; title: string; sub?: string; onPress: () => void; onMore?: () => void }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: t.card, borderRadius: 14, marginBottom: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: t.line }}>
      <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} style={{ flex: 1, minHeight: 64, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, gap: 14 }}>
        <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: t.accent + '1F', alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={icon} size={24} color={t.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ fontSize: 16, fontWeight: '600', color: t.text }}>{title}</Text>
          {sub ? <Text numberOfLines={2} style={{ fontSize: 13, color: t.sub, marginTop: 2 }}>{sub}</Text> : null}
        </View>
      </Pressable>
      {onMore ? <IconBtn icon="ellipsis-horizontal" label={`Meer voor ${title}`} onPress={onMore} /> : null}
    </View>
  );
}

export function Busy({ text }: { text: string }) {
  const t = useTheme();
  return (
    <Modal transparent visible animationType="fade">
      <View style={{ flex: 1, backgroundColor: '#0007', alignItems: 'center', justifyContent: 'center' }} accessibilityLiveRegion="polite">
        <View style={{ backgroundColor: t.sheet, padding: 24, borderRadius: 18, alignItems: 'center', gap: 12, minWidth: 180 }}>
          <ActivityIndicator size="large" color={t.accent} />
          <Text style={{ color: t.text, fontSize: 16, fontWeight: '600' }}>{text}</Text>
        </View>
      </View>
    </Modal>
  );
}

export function Toast({ text }: { text: string | null }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  if (!text) return null;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 16, right: 16, bottom: 150 + insets.bottom, alignItems: 'center' }} accessibilityLiveRegion="polite">
      <View style={{ backgroundColor: t.dark ? '#E8ECF4' : '#1B2030', paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12 }}>
        <Text style={{ color: t.dark ? '#10131A' : '#fff', fontSize: 15, fontWeight: '600' }}>{text}</Text>
      </View>
    </View>
  );
}
