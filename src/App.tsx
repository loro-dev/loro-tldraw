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
  TLDrawShapeSegment,
  StoreListener,
} from "@tldraw/tldraw";
import { throttle } from "throttle-debounce";
import { Slider, Theme } from "@radix-ui/themes";
import "@radix-ui/themes/styles.css";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Container,
  Loro,
  LoroList,
  LoroMap,
  MapDiff,
  OpId,
  toReadableVersion,
} from "loro-crdt";
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
    const listener = function syncStoreChangesToLoroDoc({ changes }) {
      if (doc.is_detached()) {
        return;
      }
      Object.values(changes.added).forEach((record) => {
        addRecord(docStore, record);
      });
      Object.values(changes.updated).forEach(([_, record]) => {
        updateRecord(doc, docStore, record);
      });
      Object.values(changes.removed).forEach((record) => {
        docStore.delete(record.id);
      });
      doc.commit();
    } as StoreListener<TLRecord>;
    unsubs.push(
      store.listen(
        throttle(100, listener),
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

        const afterValue = docStore.getDeepValue();
        if (e.path.length === 1) {
          // container
          const diff = e.diff as MapDiff;
          for (let id of Object.keys(diff.updated)) {
            if (afterValue[id]) {
              toPut.push(afterValue[id]);
            } else {
              // @ts-ignore
              toRemove.push(id);
            }
          }
        } else {
          const id = e.path[1];
          // @ts-ignore
          toRemove.push(id);
          if (afterValue[id]) {
            toPut.push(afterValue[id]);
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
          width: "66%",
          bottom: "128px",
        }}
      >
        <div style={{ fontSize: "0.8em" }}>
          Version Vector {vv}, Doc Size {docSize} bytes
        </div>
        <Theme>
          <Slider
            value={[versionNum]}
            max={maxVersion}
            min={-1}
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

const addRecord = (loroMap: LoroMap, record: TLRecord) => {
  const recordMap = loroMap.setContainer(record.id, "Map");
  for (const [key, value] of Object.entries(record)) {
    if (key === "props" || key === "meta") {
      const propsMap = recordMap.setContainer(key, "Map");
      for (const [k, v] of Object.entries(value)) {
        if (k === "segments") {
          const segmentsList = propsMap.setContainer(k, "List");
          // @ts-ignore
          for (let i = 0; i < v.length; i++) {
            // @ts-ignore
            addSegments(segmentsList.insertContainer(i, "Map"), v[i]);
          }
        } else {
          propsMap.set(k, v);
        }
      }
    } else {
      recordMap.set(key, value);
    }
  }
};

const addSegments = (segmentsMap: LoroMap, segments: TLDrawShapeSegment) => {
  segmentsMap.set("type", segments.type);
  const points = segments.points;
  const pointsList = segmentsMap.setContainer("points", "List");
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    pointsList.insert(i, point);
  }
};

const updateSegments = (
  doc: Loro,
  segmentsMap: LoroMap,
  segments: TLDrawShapeSegment
) => {
  if (segmentsMap.get("type") !== segments.type) {
    addSegments(segmentsMap, segments);
  } else {
    const pointId = segmentsMap.get("points") as Container;
    const points = doc.getContainerById(pointId.id) as LoroList;
    for (let i = points.length; i < segments.points.length; i++) {
      points.insert(i, segments.points[i]);
    }
  }
};

// assert record id is unique
const updateRecord = (doc: Loro, loroStore: LoroMap, record: TLRecord) => {
  const id = loroStore.get(record.id)! as Container;
  if (!id) {
    addRecord(loroStore, record);
    return;
  }
  const recordMap = doc.getContainerById(id.id) as LoroMap;
  for (const [key, value] of Object.entries(record)) {
    if (key === "props" || key === "meta") {
      // TODO: text use Text Container
      const src = recordMap.get(key) as Container;
      const propsMap = doc.getContainerById(src.id) as LoroMap;
      for (const [k, v] of Object.entries(value)) {
        if (k === "segments") {
          const segments = doc.getContainerById(
            (propsMap.get(k) as Container).id
          ) as LoroList;
          // @ts-ignore
          for (let i = 0; i < v.length; i++) {
            let mapContainer;
            if (i > segments.length - 1) {
              mapContainer = segments.insertContainer(i, "Map");
            } else {
              mapContainer = doc.getContainerById(
                (segments.get(i) as Container).id
              ) as LoroMap;
            }
            // @ts-ignore
            updateSegments(doc, mapContainer, v[i]);
          }
        } else if (propsMap.get(k) !== v) {
          propsMap.set(k, v);
        }
      }
    } else if (recordMap.get(key) !== value) {
      recordMap.set(key, value);
    }
  }
};
