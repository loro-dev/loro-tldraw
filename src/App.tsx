import "@tldraw/tldraw/tldraw.css";
import {
  TLRecord,
  TLStoreWithStatus,
  createTLStore,
  defaultShapeUtils,
  Tldraw,
  track,
  useEditor,
  Editor,
} from "@tldraw/tldraw";
import { Slider, Theme } from "@radix-ui/themes";
import "@radix-ui/themes/styles.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { Loro, OpId, toReadableVersion } from "loro-crdt";
import { DEFAULT_STORE } from "./default_store";

export default function LoroExample() {
  const versionsRef = useRef<OpId[][]>([]);
  const [maxVersion, setMaxVersion] = useState(-1);
  const [docSize, setDocSize] = useState(0);
  const [vv, setVV] = useState("");
  const [versionNum, setVersionNum] = useState(-1);
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

  const [doc] = useState(() => {
    return new Loro();
  });

  useEffect(() => {
    const channel = new BroadcastChannel("temp");
    // const doc = new Loro();
    const docStore = doc.getMap("tl_draw");
    const unsubs: (() => void)[] = [];
    unsubs.push(
      store.listen(
        function syncStoreChangesToLoroDoc({ changes }) {
          if (doc.is_detached()) {
            return;
          }
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
    // for (const record of store.allRecords()) {
    //   docStore.set(record.id, record);
    // }
    // doc.commit();
    const subs = doc.subscribe((e) => {
      const version = Object.fromEntries(toReadableVersion(doc.version()));
      let vv = "";
      for (const [k, v] of Object.entries(version)) {
        vv += `${k.toString().slice(0, 4)}:${v} `;
      }
      setVV(vv);
      if (e.local && !e.fromCheckout) {
        const bytes = doc.exportFrom(lastVersion);
        lastVersion = doc.version();
        channel.postMessage({ bytes, lastVersion });
      }
      if (!e.fromCheckout) {
        versionsRef.current.push(doc.frontiers());
        setMaxVersion(versionsRef.current.length - 1);
        setVersionNum(versionsRef.current.length - 1);
        setDocSize(doc.exportFrom().length);
      }
      if (e.fromCheckout || !e.local) {
        const toRemove: TLRecord["id"][] = [];
        const toPut: TLRecord[] = [];
        const diff = e.diff;

        if (diff.type === "map") {
          for (let id of Object.keys(diff.updated)) {
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
      }
    });
    unsubs.push(() => doc.unsubscribe(subs));

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

  const editor = useRef<Editor | null>(null);

  return (
    <div style={{ position: "relative", height: "100vh" }}>
      <div className="tldraw__editor">
        <Tldraw
          autoFocus
          store={storeWithStatus}
          shareZone={<NameEditor />}
          onMount={(edt) => {
            editor.current = edt;
          }}
        />
      </div>
      <div
        style={{
          position: "absolute",
          left: "50%",
          transform: "translateX(-50%)",
          height: "32px",
          width: "500px",
          bottom: "64px",
        }}
      >
        <div style={{ fontSize: "0.8em" }}>
          Version Vector {vv}, Doc Size {docSize} bytes
        </div>
        <Theme>
          <Slider
            value={[versionNum]}
            max={maxVersion}
            onValueChange={(v) => {
              if (v[0] === maxVersion) {
                editor.current?.updateInstanceState({
                  isReadonly: false,
                });
              } else if (!editor.current?.instanceState.isReadonly) {
                editor.current?.updateInstanceState({
                  isReadonly: true,
                });
              }
              setVersionNum(v[0]);
              if (v[0] === -1) {
                doc.checkout([]);
              } else {
                if (v[0] === versionsRef.current.length - 1) {
                  doc.checkoutToLatest();
                } else {
                  doc.checkout(versionsRef.current[v[0]]);
                }
              }
            }}
          />
        </Theme>
      </div>
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
