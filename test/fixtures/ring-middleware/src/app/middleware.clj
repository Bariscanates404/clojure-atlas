(ns app.middleware)

(defn wrap-auth [handler] (fn [req] (handler req)))
(defn with-log [handler] (fn [req] (handler req)))
(defn plain-helper [x] x)
