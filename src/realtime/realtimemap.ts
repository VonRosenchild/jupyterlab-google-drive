// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import {
  clearSignalData, defineSignal, ISignal
} from 'phosphor/lib/core/signaling';

import {
  JSONObject
} from 'phosphor/lib/algorithm/json';

import {
  IRealtime,
  IRealtimeConverter, Synchronizable
} from 'jupyterlab/lib/common/realtime';

import {
  IObservableMap, ObservableMap
} from 'jupyterlab/lib/common/observablemap';

import {
  IObservableVector
} from 'jupyterlab/lib/common/observablevector';

import {
  GoogleSynchronizable
} from './googlerealtime';

import {
  GoogleRealtimeVector
} from './realtimevector';

import {
  GoogleRealtimeString
} from './realtimestring';

import {
  toGoogleSynchronizable, DefaultConverter
} from './utils';

declare let gapi : any;

export
class GoogleRealtimeMap<T> implements IObservableMap<T> {

  /**
   * Constructor
   */
  constructor( model: gapi.drive.realtime.Model, converters?: Map<string, IRealtimeConverter<T>>) {
    this._converters = converters || new Map<string, IRealtimeConverter<T>>();
    this._map = new ObservableMap<T>();
    this._model = model;
  }

  /**
   * A signal emitted when the map has changed.
   */
  changed: ISignal<GoogleRealtimeMap<T>, ObservableMap.IChangedArgs<T>>;

  /**
   * Get whether this map can be linked to another.
   *
   * @returns `false`,
   */
  readonly isLinkable: boolean = false;

  /**
   * Get whether this map is linked to another.
   *
   * @returns `false`,
   */
  readonly isLinked: boolean = false;

  readonly converters: Map<string, IRealtimeConverter<T>> = null;

  /**
   * The number of key-value pairs in the map.
   */
  get size(): number {
    return this._gmap.size;
  }

  /**
   * Whether this map has been disposed.
   */
  get isDisposed(): boolean {
    return this._isDisposed;
  }

  /**
   * Get the underlying collaborative object
   * for this map.
   */
  get googleObject(): gapi.drive.realtime.CollaborativeMap<GoogleSynchronizable> {
    return this._gmap;
  }


  set googleObject(map: gapi.drive.realtime.CollaborativeMap<GoogleSynchronizable>) {
    //Create and populate the internal maps
    this._gmap = map;
    for (let key of this._gmap.keys()) {
      let entry = this._createNewEntry(key, this._gmap.get(key));
      this._map.set(key, entry);
    }

    this._gmap.addEventListener(
      gapi.drive.realtime.EventType.VALUE_CHANGED, (evt: any)=>{
        if(!evt.isLocal) {
          let changeType: ObservableMap.ChangeType;
          if(evt.oldValue && evt.newValue) {
            changeType = 'change';
          } else if (evt.oldValue && !evt.newValue) {
            changeType = 'remove';
          } else {
            changeType = 'add';
          }
          let entry = this._createNewEntry(evt.property, evt.newValue);
          this._map.set(evt.property, entry);
          this.changed.emit({
            type: changeType,
            key: evt.property,
            oldValue: evt.oldValue,
            newValue: evt.newValue
          });
        }
      }
    );
  }

  /**
   * Set a key-value pair in the map
   *
   * @param key - The key to set.
   *
   * @param value - The value for the key.
   *
   * @returns the old value for the key, or undefined
   *   if that did not exist.
   */
  set(key: string, value: T): T {
    let oldVal = this._map.get(key);
    this._gmap.set(key, this._createNewGoogleEntry(key, value) as any);
    this._map.set(key, value);
    this.changed.emit({
      type: oldVal ? 'change' : 'add',
      key: key,
      oldValue: oldVal,
      newValue: value
    });
    return oldVal;
      
  }

  /**
   * Get a value for a given key.
   *
   * @param key - the key.
   *
   * @returns the value for that key.
   */
  get(key: string): T {
    return this._map.get(key);
  }

  /**
   * Check whether the map has a key.
   *
   * @param key - the key to check.
   *
   * @returns `true` if the map has the key, `false` otherwise.
   */
  has(key: string): boolean {
    return this._map.has(key);
  }

  /**
   * Get a list of the keys in the map.
   *
   * @returns - a list of keys.
   */
  keys(): string[] {
    return this._map.keys();
  }

  /**
   * Get a list of the values in the map.
   *
   * @returns - a list of values.
   */
  values(): T[] {
    return this._map.values();
  }

  /**
   * Remove a key from the map
   *
   * @param key - the key to remove.
   *
   * @returns the value of the given key,
   *   or undefined if that does not exist. 
   */
  delete(key: string): T {
    let oldVal = this._map.get(key);
    this._map.delete(key);
    this._gmap.delete(key);
    this.changed.emit({
      type: 'remove',
      key: key,
      oldValue: oldVal,
      newValue: undefined
    });
    return oldVal;
  }

  /**
   * Link the map to another map.
   * Any changes to either are mirrored in the other.
   *
   * @param map: the parent map.
   */
  link(map: IObservableMap<T>): void {
    //no-op
  }

  /**
   * Unlink the map from its parent map.
   */
  unlink(): void {
    //no-op
  }

  linkSet(key: string, val: any, shadowVal: any): void {
    this._map.set(key, val as T);
    this._gmap.set(key, toGoogleSynchronizable(shadowVal));
  }

  /**
   * Set the ObservableMap to an empty map.
   */
  clear(): void {
    //delete one by one so that we send
    //the appropriate signals.
    let keyList = this.keys();
    for(let i=0; i<keyList.length; i++) {
      this.delete(keyList[i]);
      this._gmap.delete(keyList[i]);
    }
  }

  /**
   * Dispose of the resources held by the map.
   */
  dispose(): void {
    if(this._isDisposed) {
      return;
    }
    clearSignalData(this);
    this._gmap.removeAllEventListeners();
    this._map.clear();
    this._gmap = null;
    this._isDisposed = true;
  }

  private _createNewEntry(key: string, item: any): any {
    if(!item) return item;
    if(item.type && item.type==='List') {
      let vec = new GoogleRealtimeVector<T>(this._model);
      vec.googleObject = item;
      if(this._converters.has(key)) {
        let newEntry = this._converters.get(key).from(vec);
        (this._converters.get(key).to(newEntry) as any).link(vec);
        return newEntry;
      } else return vec;
    } else if(item.type && item.type === 'EditableString') {
      let str = new GoogleRealtimeString();
      str.googleObject = item;
      return str;
    } else if(item.type && item.type === 'Map') {
      let map = new GoogleRealtimeMap<T>(this._model);
      map.googleObject = item;
      return map;
    } else {
      return item;
    }
  }

  private _createNewGoogleEntry(key: string, item: any): GoogleSynchronizable {
    if(this._converters.has(key)) {
      let newItem: Synchronizable = this._converters.get(key).to(item);
      return toGoogleSynchronizable(newItem);
    } else {
      return item;
    }
  }

  private _model: gapi.drive.realtime.Model = null;
  private _converters: Map<string, IRealtimeConverter<T>> = null;
  private _gmap : gapi.drive.realtime.CollaborativeMap<GoogleSynchronizable> = null;
  private _map : ObservableMap<T> = null;
  private _isDisposed : boolean = false;
}

// Define the signal for the collaborator map.
defineSignal(GoogleRealtimeMap.prototype, 'changed');
