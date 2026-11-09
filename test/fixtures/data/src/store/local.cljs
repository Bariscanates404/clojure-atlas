(ns store.local
  (:require [datascript.core :as ds]))

(def schema {:todo/tags {:db/cardinality :db.cardinality/many}
             :todo/owner {:db/valueType :db.type/ref}})

(defn add-todo [conn tag] (ds/transact! conn [{:todo/tags tag}]))
