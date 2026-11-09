(ns shop.macros)
(defmacro defhandler [name args & body] `(defn ~name ~args ~@body))
