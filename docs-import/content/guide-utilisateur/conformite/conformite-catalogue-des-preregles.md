# Conformité : le catalogue des préréglages

Obliance propose 12 préréglages de conformité prêts à l'emploi, accessibles depuis l'onglet **Politiques** de la page Conformité.

## Utiliser un préréglage

Dans l'onglet **Conformité** > **Politiques**, une section **Préréglages** liste les 12 modèles disponibles. Chaque carte affiche le nombre de règles qu'il contient et une courte description. Deux usages possibles :

- L'appliquer tel quel : la politique est créée directement avec toutes les règles du préréglage.
- S'en servir de base personnalisable via le bouton **Partir d'un template** : le contenu du préréglage est repris dans l'éditeur de politique, et vous pouvez ensuite ajouter, modifier ou retirer des règles avant de l'enregistrer sous votre propre politique.

Dans les deux cas, vous choisissez ensuite la cible : tous les appareils, ou un ou plusieurs groupes précis.

## Les 12 préréglages disponibles

### Bases de sécurité génériques (référentiel "Custom")

| Préréglage | Plateforme | Contenu |
|---|---|---|
| **Windows Security Baseline** | Windows 10/11 et Server 2016+ | 80 règles couvrant le pare-feu, Windows Defender, la gestion des comptes, les identifiants, le réseau, les services, les mises à jour et l'accès distant. |
| **Windows Haute Performance** | Windows 10/11 | Règles orientées optimisation (postes de type gaming ou poste bureautique performant) : désactivation de la télémétrie et des services inutiles, réduction des effets visuels, activation du profil d'alimentation haute performance, planification GPU et optimisations réseau. |
| **Linux Security Baseline** | Debian, Ubuntu, RHEL, Fedora (compatible pare-feu UFW et firewalld) | Contrôles sur le système de fichiers, les services activés inutilement, la configuration réseau, SSH, la politique de mots de passe et l'audit système. |
| **macOS Security Baseline** | macOS 12 et ultérieur (Monterey à Sequoia) | Contrôles sur SIP, Gatekeeper, FileVault, le pare-feu, le réseau, les comptes, les mises à jour, la confidentialité, l'audit, SSH et Safari. Les contrôles s'exécutent avec des droits administrateur complets sur la machine. |
| **FreeBSD Security Baseline** | FreeBSD | Contrôles sur le système de fichiers, l'authentification SSH, le pare-feu PF, les services, les permissions et les mises à jour via pkg / freebsd-update. |
| **OPNsense Security Baseline** | Appliances pare-feu OPNsense | Vérifie la configuration du pare-feu, les services actifs, l'authentification (y compris double authentification, LDAP ou RADIUS), les mises à jour et la présence de sauvegardes. Une partie de ces règles n'a pas de correction automatique disponible : elles servent surtout à détecter un écart de configuration à corriger manuellement. |

### Référentiels réglementaires et normatifs officiels (tous pour Windows)

| Préréglage | Référentiel | Contenu |
|---|---|---|
| **CIS Windows Level 1** | CIS Benchmark Windows 10/11 Enterprise, niveau 1 | Règles de politique de comptes et d'attribution des droits utilisateurs. |
| **NIST SP 800-171 (Windows)** | NIST SP 800-171 révision 2 | Protection des informations sensibles non classifiées (CUI), règles regroupées par famille (contrôle d'accès, audit, gestion de la configuration, identification, réponse aux incidents, maintenance, protection des supports...). |
| **ISO 27001:2022 (Windows)** | ISO 27001, Annexe A | Règles regroupées par thème : organisationnel, humain, physique, technologique. |
| **PCI DSS v4 (Windows)** | PCI DSS version 4.0 | Couvre les 12 exigences PCI DSS pour la partie Windows d'un environnement de traitement de cartes de paiement. Ce préréglage n'est pas un substitut à un audit officiel réalisé par un auditeur qualifié (QSA) : il vise à préparer et fiabiliser le terrain avant un audit. |
| **HIPAA Security Rule (Windows)** | HIPAA, 45 CFR partie 164 | Règles administratives, physiques et techniques issues de la réglementation santé américaine, plus des règles techniques complémentaires. |
| **SOC 2 Type II (Windows)** | AICPA Trust Service Criteria | Couvre les critères de sécurité, disponibilité, intégrité de traitement, confidentialité et respect de la vie privée. |

## Comment choisir

- Si vous voulez simplement sécuriser un parc sans contrainte réglementaire particulière : partez d'une des bases génériques (**Windows Security Baseline**, **Linux Security Baseline**, **macOS Security Baseline**...) adaptée au système visé.
- Si votre organisation doit prouver sa conformité à une norme précise pour un client, un partenaire ou un régulateur : choisissez le préréglage correspondant (NIST, ISO 27001, PCI DSS, HIPAA, SOC 2, CIS).
- Rien n'empêche d'appliquer plusieurs préréglages en parallèle sur le même groupe d'appareils si plusieurs exigences se cumulent (par exemple Windows Security Baseline et NIST SP 800-171 en même temps).
