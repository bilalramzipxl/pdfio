import { Linking, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { showAlert } from './dialog';

/** Uitleg + weg naar de instellingen als de gebruiker eerder "nee" koos. */
function explainDenied(title: string, text: string) {
  showAlert(title, `${text}\n\nOpen de instellingen van het toestel > PDF Studio en zet de toegang aan.`);
  if (Platform.OS !== 'web') Linking.openSettings().catch(() => {});
}

/** Vraagt (indien nodig) toegang tot de camera. Android en iOS tonen daarvoor hun eigen vraag. */
export async function ensureCamera(): Promise<boolean> {
  if (Platform.OS === 'web') return true;
  let p = await ImagePicker.getCameraPermissionsAsync();
  if (!p.granted && p.canAskAgain) p = await ImagePicker.requestCameraPermissionsAsync();
  if (p.granted) return true;
  explainDenied('Camera staat uit', 'Zonder camera kan de app geen foto van een pagina nemen. Je kunt ook een foto uit je galerij kiezen.');
  return false;
}

/**
 * Vraagt toegang tot de foto's. Nieuwe Android- en iOS-versies hebben een veilige fotokiezer die geen
 * toegang nodig heeft: dan gaan we door, ook als de gebruiker "nee" zegt (hij kiest dan zelf per foto).
 */
export async function ensurePhotos(): Promise<boolean> {
  if (Platform.OS === 'web') return true;
  try {
    let p = await ImagePicker.getMediaLibraryPermissionsAsync();
    if (!p.granted && p.canAskAgain) p = await ImagePicker.requestMediaLibraryPermissionsAsync();
    return true;
  } catch {
    return true; // de systeemkiezer regelt de rest
  }
}
