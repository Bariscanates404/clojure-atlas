(ns app.views)

(defn card [title]
  [:div.card {:qa-class "qa-card-title" :class "card"} title])

(defn badge []
  [:span {:class (str "badge " "qa-badge")} "b"])

(defn plain []
  [:span.qa-plain "p"])
