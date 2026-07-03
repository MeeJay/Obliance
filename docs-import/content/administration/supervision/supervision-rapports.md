# Rapports

Ce chapitre decrit l'onglet **Rapports** (*Reports*) de la page Supervision, qui permet de generer des rapports exportables sur l'etat du parc.

## Acces

L'onglet **Rapports** (*Reports*) se trouve dans **Supervision** (`/admin/supervision`). L'acces au service qui genere les rapports est protege par la capacite **`reports`** (ancien nom) ou **`supervision:read`** (nom actuel) â€” les deux sont acceptees, ce qui garantit la compatibilite avec une configuration d'equipe plus ancienne.

## Creer une definition de rapport

Un formulaire de creation permet de definir :

1. **Nom** et **description** du rapport.
2. **Type** de rapport :

   | Type | Contenu |
   |---|---|
   | Fleet | Vue d'ensemble du parc |
   | Compliance | Etat de conformite |
   | Scripts | Historique des executions de scripts |
   | Updates | Etat des mises a jour |
   | Software | Inventaire logiciel |
   | Custom | Combinaison libre de sections |

3. **Format** de sortie : JSON, CSV, PDF, Excel ou HTML.
4. **Perimetre (scope)** : tout le tenant, un groupe d'appareils specifique, ou un appareil unique.
5. **Sections** a inclure (cochables) : Hardware, Software, Updates, Compliance, Script History, Network.

## Generation immediate vs planification recurrente

Le formulaire propose deux modes :

- **Generate now** â€” genere immediatement, une seule fois, un rapport a la sauvegarde du formulaire. C'est aujourd'hui le seul moyen d'obtenir effectivement un rapport.
- **Recurring (cron)** â€” permet de saisir un planning recurrent (expression cron, presets courants, fuseau horaire).

> **Point de vigilance** : dans la version actuelle, le planning saisi en mode *Recurring (cron)* est enregistre mais **n'est exploite par aucune generation automatique** â€” aucun rapport ne se genere seul a l'heure prevue. Pour obtenir un rapport, utilisez le mode **Generate now** a la creation ou le bouton **Generate** sur une definition existante ; ne planifiez pas de rapport recurrent en comptant sur une generation automatique, en particulier pour des rapports destines a un audit de conformite.

## Recuperer un rapport genere

Chaque generation produit une **sortie** (output) associee a la definition de rapport, avec :

- un statut : *generating*, *ready* ou *error* ;
- la taille du fichier produit ;
- le nombre de lignes (rowCount) quand applicable ;
- un bouton **Download** pour telecharger le fichier une fois le statut *ready* atteint.

Chaque sortie de rapport porte une date d'expiration a **7 jours** apres sa generation. Traitez tout rapport passe ce delai comme perime et re-generez-le si vous en avez encore besoin, plutot que de vous fier a un fichier ancien : au-dela de cette echeance, le contenu n'est plus garanti a jour vis-a-vis de l'etat reel du parc.

> **Point de vigilance sur les formats** : seuls les formats **CSV** et **JSON** produisent un fichier dont le contenu correspond reellement au format annonce. Pour les formats **PDF**, **Excel** et **HTML**, le fichier genere ne contient pas un veritable document mis en forme dans ce format. Si vous devez fournir un rapport a un tiers (auditeur, client) dans un format precis, verifiez systematiquement le fichier telecharge avant envoi, et privilegiez CSV ou JSON si une exploitation fiable et immediate du contenu est necessaire.