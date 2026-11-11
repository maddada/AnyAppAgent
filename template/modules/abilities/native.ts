// The native side of modules/abilities (Kotlin: com.anyapp.abilities). App code uses the other files.
import { requireNativeModule } from 'expo';

type Subscription = { remove(): void };

type Native = {
  takeOpenedAction(): string | null;
  setMessage(text: string): void;
  setWidget(id: string, json: string): void;
  widgetIds(): string[];
  isWidgetPlaced(id: string): boolean;
  pinWidget(id: string): boolean;
  updateTile(id: string, label: string | null, subtitle: string | null, on: boolean | null): void;
  isTileOn(id: string): boolean;
  tileIds(): string[];
  takeShare(): string | null;
  deleteSharedFile(path: string): boolean;
  addListener(event: 'onOpenAction' | 'onShare', listener: () => void): Subscription;
};

export const native = requireNativeModule<Native>('AnyappAbilities');
