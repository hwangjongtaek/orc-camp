/**
 * Provides the loaded asset manifest + base path to the sprite renderer.
 * reduced-motion is read from the store so changes re-render sprites (SPEC-300 §3.5).
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { loadManifest, type AssetManifest } from './manifest';

interface AssetContextValue {
  manifest: AssetManifest | null;
  assetBase: string;
  loaded: boolean; // false until the manifest fetch settles
}

const AssetContext = createContext<AssetContextValue>({
  manifest: null,
  assetBase: '/asset-pack',
  loaded: false,
});

export function AssetProvider({
  assetBase,
  children,
}: {
  assetBase: string;
  children: ReactNode;
}): JSX.Element {
  const [manifest, setManifest] = useState<AssetManifest | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadManifest(assetBase).then((m) => {
      if (cancelled) return;
      setManifest(m);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [assetBase]);

  return (
    <AssetContext.Provider value={{ manifest, assetBase, loaded }}>
      {children}
    </AssetContext.Provider>
  );
}

export function useAssets(): AssetContextValue {
  return useContext(AssetContext);
}
