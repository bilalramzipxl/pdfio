import { Alert, Platform } from 'react-native';

type Btn = { text: string; style?: 'default' | 'cancel' | 'destructive'; onPress?: () => void };

/** Alert met knoppen. Op web (alleen voor controle) een echte in-pagina-dialoog, want Alert.alert doet daar niets. */
export function showAlert(title: string, message?: string, buttons?: Btn[]) {
  if (Platform.OS !== 'web') { Alert.alert(title, message, buttons as any); return; }
  (globalThis as any).__lastAlert = { title, message };
  const root = document.createElement('div');
  root.setAttribute('role', 'alertdialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', title);
  root.style.cssText = 'position:fixed;inset:0;background:#0008;display:flex;align-items:center;justify-content:center;z-index:99999;font-family:system-ui';
  const box = document.createElement('div');
  box.style.cssText = 'background:#fff;color:#10131A;border-radius:16px;padding:20px;max-width:340px;width:86%';
  box.innerHTML = `<div style="font-weight:800;font-size:18px;margin-bottom:6px"></div><div style="color:#5B6472;margin-bottom:14px"></div>`;
  (box.children[0] as HTMLElement).textContent = title; (box.children[1] as HTMLElement).textContent = message ?? '';
  const close = () => root.remove();
  for (const b of buttons?.length ? buttons : [{ text: 'OK' } as Btn]) {
    const el = document.createElement('button');
    el.textContent = b.text; el.setAttribute('role', 'button');
    el.style.cssText = `display:block;width:100%;min-height:48px;margin-top:8px;border-radius:12px;border:1px solid #E2E6EE;background:#fff;font-size:16px;font-weight:700;color:${b.style === 'destructive' ? '#B42318' : '#1D4ED8'}`;
    el.onclick = () => { close(); b.onPress?.(); };
    box.appendChild(el);
  }
  root.appendChild(box); document.body.appendChild(root);
}
