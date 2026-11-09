(ns sys.comp
  (:require [com.stuartsierra.component :as component]))

(defn new-db [] {})
(defn new-app [] {})

(defn system []
  (component/system-map
    :db (new-db)
    :app (component/using (new-app) [:db])))
