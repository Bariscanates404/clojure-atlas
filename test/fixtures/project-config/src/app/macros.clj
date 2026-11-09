(ns app.macros)

(defmacro defthing [name value] `(def ~name ~value))

(defmacro deftrecord [name fields & body] `(defrecord ~name ~fields ~@body))
