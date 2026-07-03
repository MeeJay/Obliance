# ConformitÃ© : le catalogue des prÃ©rÃ©glages

Obliance propose 12 prÃ©rÃ©glages de conformitÃ© prÃªts Ã  l'emploi, accessibles depuis l'onglet **Politiques** de la page ConformitÃ©.

## Utiliser un prÃ©rÃ©glage

Dans l'onglet **ConformitÃ©** > **Politiques**, une section **PrÃ©rÃ©glages** liste les 12 modÃ¨les disponibles. Chaque carte affiche le nombre de rÃ¨gles qu'il contient et une courte description. Deux usages possibles :

- L'appliquer tel quel : la politique est crÃ©Ã©e directement avec toutes les rÃ¨gles du prÃ©rÃ©glage.
- S'en servir de base personnalisable via le bouton **Partir d'un template** : le contenu du prÃ©rÃ©glage est repris dans l'Ã©diteur de politique, et vous pouvez ensuite ajouter, modifier ou retirer des rÃ¨gles avant de l'enregistrer sous votre propre politique.

Dans les deux cas, vous choisissez ensuite la cible : tous les appareils, ou un ou plusieurs groupes prÃ©cis.

## Les 12 prÃ©rÃ©glages disponibles

### Bases de sÃ©curitÃ© gÃ©nÃ©riques (rÃ©fÃ©rentiel "Custom")

| PrÃ©rÃ©glage | Plateforme | Contenu |
|---|---|---|
| **Windows Security Baseline** | Windows 10/11 et Server 2016+ | 80 rÃ¨gles couvrant le pare-feu, Windows Defender, la gestion des comptes, les identifiants, le rÃ©seau, les services, les mises Ã  jour et l'accÃ¨s distant. |
| **Windows Haute Performance** | Windows 10/11 | RÃ¨gles orientÃ©es optimisation (postes de type gaming ou poste bureautique performant) : dÃ©sactivation de la tÃ©lÃ©mÃ©trie et des services inutiles, rÃ©duction des effets visuels, activation du profil d'alimentation haute performance, planification GPU et optimisations rÃ©seau. |
| **Linux Security Baseline** | Debian, Ubuntu, RHEL, Fedora (compatible pare-feu UFW et firewalld) | ContrÃ´les sur le systÃ¨me de fichiers, les services activÃ©s inutilement, la configuration rÃ©seau, SSH, la politique de mots de passe et l'audit systÃ¨me. |
| **macOS Security Baseline** | macOS 12 et ultÃ©rieur (Monterey Ã  Sequoia) | ContrÃ´les sur SIP, Gatekeeper, FileVault, le pare-feu, le rÃ©seau, les comptes, les mises Ã  jour, la confidentialitÃ©, l'audit, SSH et Safari. Les contrÃ´les s'exÃ©cutent avec des droits administrateur complets sur la machine. |
| **FreeBSD Security Baseline** | FreeBSD | ContrÃ´les sur le systÃ¨me de fichiers, l'authentification SSH, le pare-feu PF, les services, les permissions et les mises Ã  jour via pkg / freebsd-update. |
| **OPNsense Security Baseline** | Appliances pare-feu OPNsense | VÃ©rifie la configuration du pare-feu, les services actifs, l'authentification (y compris double authentification, LDAP ou RADIUS), les mises Ã  jour et la prÃ©sence de sauvegardes. Une partie de ces rÃ¨gles n'a pas de correction automatique disponible : elles servent surtout Ã  dÃ©tecter un Ã©cart de configuration Ã  corriger manuellement. |

### RÃ©fÃ©rentiels rÃ©glementaires et normatifs officiels (tous pour Windows)

| PrÃ©rÃ©glage | RÃ©fÃ©rentiel | Contenu |
|---|---|---|
| **CIS Windows Level 1** | CIS Benchmark Windows 10/11 Enterprise, niveau 1 | RÃ¨gles de politique de comptes et d'attribution des droits utilisateurs. |
| **NIST SP 800-171 (Windows)** | NIST SP 800-171 rÃ©vision 2 | Protection des informations sensibles non classifiÃ©es (CUI), rÃ¨gles regroupÃ©es par famille (contrÃ´le d'accÃ¨s, audit, gestion de la configuration, identification, rÃ©ponse aux incidents, maintenance, protection des supports...). |
| **ISO 27001:2022 (Windows)** | ISO 27001, Annexe A | RÃ¨gles regroupÃ©es par thÃ¨me : organisationnel, humain, physique, technologique. |
| **PCI DSS v4 (Windows)** | PCI DSS version 4.0 | Couvre les 12 exigences PCI DSS pour la partie Windows d'un environnement de traitement de cartes de paiement. Ce prÃ©rÃ©glage n'est pas un substitut Ã  un audit officiel rÃ©alisÃ© par un auditeur qualifiÃ© (QSA) : il vise Ã  prÃ©parer et fiabiliser le terrain avant un audit. |
| **HIPAA Security Rule (Windows)** | HIPAA, 45 CFR partie 164 | RÃ¨gles administratives, physiques et techniques issues de la rÃ©glementation santÃ© amÃ©ricaine, plus des rÃ¨gles techniques complÃ©mentaires. |
| **SOC 2 Type II (Windows)** | AICPA Trust Service Criteria | Couvre les critÃ¨res de sÃ©curitÃ©, disponibilitÃ©, intÃ©gritÃ© de traitement, confidentialitÃ© et respect de la vie privÃ©e. |

## Comment choisir

- Si vous voulez simplement sÃ©curiser un parc sans contrainte rÃ©glementaire particuliÃ¨re : partez d'une des bases gÃ©nÃ©riques (**Windows Security Baseline**, **Linux Security Baseline**, **macOS Security Baseline**...) adaptÃ©e au systÃ¨me visÃ©.
- Si votre organisation doit prouver sa conformitÃ© Ã  une norme prÃ©cise pour un client, un partenaire ou un rÃ©gulateur : choisissez le prÃ©rÃ©glage correspondant (NIST, ISO 27001, PCI DSS, HIPAA, SOC 2, CIS).
- Rien n'empÃªche d'appliquer plusieurs prÃ©rÃ©glages en parallÃ¨le sur le mÃªme groupe d'appareils si plusieurs exigences se cumulent (par exemple Windows Security Baseline et NIST SP 800-171 en mÃªme temps).
