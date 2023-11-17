import "@tldraw/tldraw/tldraw.css";
import {
  TLRecord,
  TLStoreWithStatus,
  createTLStore,
  defaultShapeUtils,
  Tldraw,
  track,
  useEditor,
  transact,
} from "@tldraw/tldraw";
import { useEffect, useMemo, useState } from "react";
import { Loro } from "loro-crdt";
import { DEFAULT_STORE } from "./default_store";

export default function LoroExample() {
  const channel = useMemo(() => {
    return new BroadcastChannel("temp");
  }, []);

  const [storeWithStatus, setStoreWithStatus] = useState<TLStoreWithStatus>({
    status: "loading",
  });
  const [store] = useState(() => {
    const store = createTLStore({
      shapeUtils: defaultShapeUtils,
    });
    store.loadSnapshot(DEFAULT_STORE);
    return store;
  });

  useEffect(() => {
    const channel = new BroadcastChannel("temp");
    const doc = new Loro();
    const docStore = doc.getMap("tl_draw");
    const unsubs: (() => void)[] = [];
    unsubs.push(
      store.listen(
        function syncStoreChangesToLoroDoc({ changes }) {
          Object.values(changes.added).forEach((record) => {
            docStore.set(record.id, record);
          });
          Object.values(changes.updated).forEach(([_, record]) => {
            docStore.set(record.id, record);
          });

          Object.values(changes.removed).forEach((record) => {
            docStore.delete(record.id);
          });
          doc.commit();
        },
        { source: "user", scope: "document" } // only sync user's document changes
      )
    );

    let lastVersion: Uint8Array | undefined = undefined;
    channel.onmessage = (e) => {
      lastVersion = e.data.lastVersion;
      const bytes = new Uint8Array(e.data.bytes);
      doc.import(bytes);
    };

    const subs = doc.subscribe((e) => {
      if (e.local) {
        const bytes = doc.exportFrom(lastVersion);
        lastVersion = doc.version();
        channel.postMessage({ bytes, lastVersion });
      }
      if (e.fromCheckout || !e.local) {
        const toRemove: TLRecord["id"][] = [];
        const toPut: TLRecord[] = [];
        const diff = e.diff;
        if (diff.type === "map") {
          for (let id in Object.keys(diff.updated)) {
            const record = diff.updated[id];
            if (record) {
              // @ts-ignore
              toPut.push(record as TLRecord);
            } else {
              toRemove.push(id as TLRecord["id"]);
            }
          }
        }
        // put / remove the records in the store
        store.mergeRemoteChanges(() => {
          if (toRemove.length) store.remove(toRemove);
          if (toPut.length) store.put(toPut);
        });

        transact(() => {
          store.clear();
          const records = Object.values(docStore.value);
          // @ts-ignore
          store.put(records);
        });
      }
    });
    unsubs.push(() => doc.unsubscribe(subs));

    for (const record of store.allRecords()) {
      docStore.set(record.id, record);
    }
    doc.commit();

    setStoreWithStatus({
      store,
      status: "synced-remote",
      connectionStatus: "online",
    });
    return () => {
      unsubs.forEach((fn) => fn());
      unsubs.length = 0;
      channel.close();
    };
  }, [channel, store]);

  return (
    <div className="tldraw__editor">
      <Tldraw store={storeWithStatus} shareZone={<NameEditor />} />
    </div>
  );
}

const NameEditor = track(() => {
  const editor = useEditor();

  const { color, name } = editor.user;

  return (
    <div style={{ pointerEvents: "all", display: "flex" }}>
      <input
        type="color"
        value={color}
        onChange={(e) => {
          editor.user.updateUserPreferences({
            color: e.currentTarget.value,
          });
        }}
      />
      <input
        value={name}
        onChange={(e) => {
          editor.user.updateUserPreferences({
            name: e.currentTarget.value,
          });
        }}
      />
    </div>
  );
});
