(ns sys.ig
  (:require [integrant.core :as ig]))

(defn connect [url] url)

(defmethod ig/init-key :app/db [_ {:keys [url]}] (connect url))

(defmethod ig/halt-key! :app/db [_ conn] conn)

(defmethod ig/init-key ::worker [_ opts] opts)

(def config {::worker {:db (ig/ref :app/db)}})
