(ns store.users
  (:require [datomic.api :as d]))

(defn create-user! [conn email]
  @(d/transact conn [{:db/id "u" :user/email email :user/status :user.status/active}
                     [:db/add "u" :user/name "x"]]))

(defn by-email [db email]
  (d/q '[:find ?e :in $ ?email :where [?e :user/email ?email]] db email))

(defn names [db e]
  (d/pull db [:user/name {:user/friends [:user/email]}] e))

(def name-query '[:find ?n :where [_ :user/name ?n]])

(defn display [user] (:user/name user))

(defn rename-tx [e n] {:db/id e :user/name n})
