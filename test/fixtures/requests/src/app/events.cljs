(ns app.events
  (:require [re-frame.core :as rf]
            [ajax.core :as ajax]
            [cljs-http.client :as http]))

(rf/reg-event-fx ::load-users
  (fn [_ _] {:http-xhrio {:method :get :uri "/api/users/" :on-success [::loaded]}}))

(rf/reg-event-fx ::load-user
  (fn [_ [_ id]] {:backend-request {:method :get :uri (str "/api/users/" id) :on-success [::loaded]}}))

(defn create! [user] (ajax/POST "/api/users" {:params user}))

(defn ping [] (http/get "/api/health"))

(defn raw [] (js/fetch "/api/users" #js {:method "DELETE"}))

(defn api-url [& paths] (apply str "/api" paths))

(rf/reg-event-fx ::remove-user
  (fn [_ [_ id]] {:http-xhrio {:method :delete :uri (api-url "/users/" id) :on-success [::loaded]}}))

(rf/reg-event-fx ::reload
  (fn [_ _] {:http-xhrio {:method :get :uri (api-url "/users") :on-success [::loaded]}}))
