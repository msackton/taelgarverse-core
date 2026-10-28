class NameManager {

    #getElementFromMetadata(elem) {
        if (customJS.state.coreMeta) {
            return customJS.state.coreMeta[elem];
        }

        return undefined;
    }

    getPageType(metadata) {

        if (!metadata) return "unknown"

        // Normalize tags to an array of strings; Dataview page objects or YAML can vary
        let rawTags = metadata.tags;
        let tags = [];
        if (Array.isArray(rawTags)) tags = rawTags;
        else if (typeof rawTags === 'string' || rawTags instanceof String) tags = [rawTags];
        // Some contexts only expose tags on the file object or as etags
        else if (metadata.file?.tags && Array.isArray(metadata.file.tags)) tags = metadata.file.tags;
        else if (metadata.file?.etags && Array.isArray(metadata.file.etags)) tags = metadata.file.etags.map(t => t.replace(/^#/, ''));

        // define fixed types
        const typePrefixes = [
            "person",
            "place",
            "object",
            "event",
            "group",
            "power",
            "ancestry",
            "creature"
        ];

        for (const tag of tags) {
            if (typeof tag !== "string") continue;
            for (const type of typePrefixes) {
                if (tag.startsWith(type)) {
                    return type;
                }
            }
        }
        return "unknown"
    }


    #toTitle(str) {
        const lowers = ['A', 'An', 'The', 'And', 'But', 'Or', 'For', 'Nor', 'As', 'At', 'By', 'For', 'From', 'In', 'Into', 'Near', 'Of', 'On', 'Onto', 'To', 'With', 'De'];

        return str.
            split(' ').
            map((elem, index) => (lowers.findIndex(item => elem.toLowerCase() === item.toLowerCase()) >= 0 && index > 0) || elem.length == 0 ? elem : (elem[0].toUpperCase() + elem.substr(1))).
            join(' ')
    }

    getCampaignConfig(codeOrAlias) {
        // `loadMetadata.js` populates this from the authoritative
        // `_scripts/session_note_campaigns.json` registry.

        const normalize = (value) => (value ?? "").toString().trim()
        const normalizeKey = (value) => normalize(value).toLowerCase()

        let query = normalizeKey(codeOrAlias)
        if (!query) return undefined

        let campaigns = customJS.state.campaignRegistry
        if (!Array.isArray(campaigns)) return undefined

        for (let c of campaigns) {
            if (!c) continue

            let code = normalize(c.code)
            let partyPage = normalize(c.partyPage)
            let sessionNoteFolder = normalize(c.sessionNoteFolder)
            let aliases = Array.isArray(c.aliases) ? c.aliases.map(a => normalize(a)).filter(Boolean) : []

            let keys = [c.slug, c.name, code, ...aliases].map(normalizeKey).filter(Boolean)
            if (!keys.includes(query)) continue

            return {
                slug: normalize(c.slug),
                name: normalize(c.name),
                code,
                partyPage,
                sessionNoteFolder,
                aliases
            }
        }

        return undefined
    }

    getCampaignPartyPage(codeOrAlias) {
        return this.getCampaignConfig(codeOrAlias)?.partyPage
    }

    getCampaignSessionNoteFolder(codeOrAlias) {
        return this.getCampaignConfig(codeOrAlias)?.sessionNoteFolder
    }

    getFileForTarget(target, filter = undefined) {

        // thought: should getFileForTarget return as well the descriptive text? e.g. //
        // getFileForTarget("climbing the Sentinel Range") returns //
        // { filename: "Sentinel Range", prefix: "climbing the ", isAlias: false, frontmatter: { ... } } //
        // getFileForTarget("climbing the Sentinels") returns //
        // { filename: "Sentinel Range", linktext: "Sentinels", prefix: "climbing the ", isAlias: true, frontmatter: { ... }
        // getFileForTarget("Sentinel Range") returns //
        // { filename: "Sentinel Range", isAlias: false, frontmatter: { ... }

        let root = window.app.vault.getRoot().path
        // quick search
        let tfile = window.app.metadataCache.getFirstLinkpathDest(target, root);
        if (tfile) {
            let fm = (window.app.metadataCache.getFileCache(tfile)?.frontmatter) ?? {}
            if (filter && !filter(fm)) return undefined
            return { filename: tfile.basename, isAlias: false, frontmatter: fm }
        }

        for (let file of window.app.vault.getMarkdownFiles()) {
            let cachedMetadata = window.app.metadataCache.getFileCache(file)
            let aliases = cachedMetadata?.frontmatter?.aliases

            let possibleReturn = undefined

            if (aliases) {
                if (typeof aliases === 'string' || aliases instanceof String) {
                    if (aliases.toLowerCase() == target.toLowerCase()) {
                        possibleReturn = { filename: file.basename, isAlias: true, frontmatter: cachedMetadata?.frontmatter ?? {} }
                    }
                }
                else {
                    for (let checker of aliases) {
                        if (checker.toLowerCase() == target.toLowerCase()) {
                            possibleReturn = { filename: file.basename, isAlias: true, frontmatter: cachedMetadata?.frontmatter ?? {} }
                        }
                    }
                }
            }

            if (possibleReturn) {
                if (!filter) return possibleReturn
                if (filter(possibleReturn.frontmatter)) return possibleReturn
            }
        }

        // custom map
        let map = this.#getElementFromMetadata("linkmap")?.find(f => f.from.toLowerCase() == target.toLowerCase())
        if (map) {
            let mappedTfile = window.app.metadataCache.getFirstLinkpathDest(map.to, root);
            if (mappedTfile) {
                let fm = window.app.metadataCache.getFileCache(mappedTfile)?.frontmatter ?? {}
                if (filter && !filter(fm)) return undefined
                return { filename: mappedTfile.basename, isAlias: map.isAlias, frontmatter: fm }
            }
        }

        return undefined
    }

    getDisplayData(target) {

        function merge_options(obj1, obj2) {
            var obj3 = {};
            if (obj1) for (var attrname in obj1) { obj3[attrname] = obj1[attrname]; }
            if (obj2) for (var attrname in obj2) { obj3[attrname] = obj2[attrname]; }
            return obj3;
        }

        let metadata = target

        if (typeof target === 'string' || target instanceof String) {
            // we have an input as a file
            let file = this.getFileForTarget(target)
            if (file) {
                // we found something for this target
                metadata = file.frontmatter
            }
            else {
                metadata = {}
            }
        }
        let required = this.#getElementFromMetadata("requiredDisplayDefaults")
        let typeDefault = this.#getElementFromMetadata("typeDisplayDefaults")
        let defaultForThisItem = typeDefault ? typeDefault[this.getPageType(metadata)] : undefined
        let base = merge_options(required, defaultForThisItem)
        return merge_options(base, metadata.displayDefaults)
    }

    // this formats a name object given the format options and returns a string
    // name = { name: the actual name, linkTarget: the target file, if there is one, article: the article, linkText: the linkText }

    formatName(name, formatSpecifier) {

        function toFirstUpper(inStr) {
            if (!inStr) return inStr
            let newStr = inStr.trim();
            return newStr.charAt(0).toUpperCase() + newStr.slice(1);
        }

        if (!name || !name.name) {
            return ""
        }

        // the format looks like: [linkText] [article] [[file|alias]]

        let formattedName = "";
        let specifier = formatSpecifier ?? ""
        let initialUpper = specifier.includes("u")

        // we include the link text if we (a) have a q but (b) do not have a negation (Q)
        if ((specifier.includes("q") || specifier.includes("v")) && !specifier.includes("Q") && name.linkText) {
            let linkText = name.linkText ?? ""
            if (initialUpper) {
                linkText = toFirstUpper(linkText)
                initialUpper = false;
            }

            formattedName = linkText + " "
        }


        if (specifier.includes("a")) {
            let article = name.indefiniteArticle ?? ""
            // title case expects the article to be upper
            if (initialUpper || specifier.includes("t")) {
                article = toFirstUpper(article)
                initialUpper = false;
            }

            formattedName += article + " "
        }
        else if (!specifier.includes("x") && name.definiteArticle) {
            let article = name.definiteArticle ?? ""
            // title case expects the article to be upper
            if (initialUpper || specifier.includes("t")) {
                article = toFirstUpper(article)
                initialUpper = false;
            }

            formattedName += article + " "
        }

        let nameStr = name.name
        if (specifier.includes("s")) {
            nameStr = nameStr.toLowerCase()
        } else if (specifier.includes("t")) {
            nameStr = this.#toTitle(nameStr)
        }

        if (initialUpper) {
            nameStr = toFirstUpper(nameStr)
            initialUpper = false;
        }

        // avoid creating links in certain cases
        if (specifier.includes("y" && !name.linkTarget)) {
            if (target.includes(",")) specifier = specifier.replace("y", "")
            let fragmentsThatDontAlwaysLink = this.#getElementFromMetadata("fragmentsThatDontAutoLink")
            if (fragmentsThatDontAlwaysLink) {
                for (let word of nameStr.split(' ')) {
                    if (fragmentsThatDontAlwaysLink.includes(word.toLowerCase())) {
                        specifier = specifier.replace("y", "")
                        break
                    }
                }
            }
        }

        // if we have a y we always generate a link
        if (specifier.includes("y")) {
            if (!name.linkTarget || name.linkTarget == nameStr) {
                formattedName += "[[" + nameStr + "]]"
            } else {
                // we have a link target that doesn't match
                formattedName += "[[" + name.linkTarget + "|" + nameStr + "]]"
            }
        } else if (specifier.includes("n")) {
            // never link
            formattedName += nameStr
        } else {
            // link if we have a target, not otherwise
            if (!name.linkTarget) {
                formattedName += nameStr
            } else if (name.linkTarget == nameStr) {
                formattedName += "[[" + nameStr + "]]"
            } else {
                // we have a link target that doesn't match
                formattedName += "[[" + name.linkTarget + "|" + nameStr + "]]"
            }
        }

        return formattedName
    }

    #getLinkText(pageMetadata, sourceType) {
        // given a page, and a origin page, get the link text describing the "link" between these pages

        let displayData = this.getDisplayData(pageMetadata)

        let prep = ""
        switch (sourceType) {
            case "person":
                prep = displayData.ltPerson != undefined ? displayData.ltPerson : displayData.linkText
                break
            case "group":
                prep = displayData.ltOrg != undefined ? displayData.ltOrg : displayData.linkText
                break
            case "place":
                prep = displayData.ltPlace != undefined ? displayData.ltPlace : displayData.linkText
                break
            case "object":
                prep = displayData.ltItem != undefined ? displayData.ltItem : displayData.linkText
                break
            default:
                prep = displayData.linkText
        }

        return prep ?? ""
    }

    #getIndefArt(inputString) {

        // indefinte article
        let lowered = inputString.toLowerCase()
        if (lowered.startsWith("uni")) {
            return "a"
        } else if (lowered[0] == "a" || lowered[0] == "e" || lowered[0] == "i" || lowered[0] == "o" || lowered[0] == "u") {
            return "an"
        } else {
            return "a"
        }
    }

    #getDefArt(inputString) {
        // given an input string this returns the article

        if (!inputString) return ""

        if (/[A-Z~]/.test(inputString)) {
            // capital letters, calculate a definite article
            let wordCount = inputString.split(' ').length
            if (wordCount > 1) return "the"
            return ""
        } else {
            return ""
        }
    }

    // this returns a name object for a string
    // name = { name: the actual name, linkTarget: the target file, if there is one, linkText: the linkText }
    // overrides providers the option to replace the name itself, the article, or the linkText
    //  { alias:, article:, linkText: }
    getNameObject(target, sourceType, overrides) {

        if (target && target.isNormalizedName) return target

        if (!overrides) overrides = {}

        // this gets the canonical name of a potential link
        if (!target || target == "Untitled") {
            return {
                name: overrides.alias ?? "",
                linkTarget: undefined,
                indefiniteArticle: overrides.indefiniteArticle ?? "",
                definiteArticle: overrides.definiteArticle ?? "",
                linkText: overrides.linkText ?? "",
                isNormalizedName: true
            }
        }

        let fileData = this.getFileForTarget(target)

        if (!fileData) {
            // we don't have a target
            return {
                name: (overrides.alias ?? target),
                linkTarget: undefined,
                definiteArticle: overrides.indefiniteArticle ?? this.#getDefArt(overrides.alias ?? target),
                indefiniteArticle: overrides.definiteArticle ?? this.#getIndefArt(overrides.alias ?? target),
                linkText: overrides.linkText ?? "",
                isNormalizedName: true
            }
        }

        // we do have a target
        let frontmatter = fileData.frontmatter
        let selectedDescriptiveName = overrides.alias ?? (fileData.isAlias ? target : fileData.filename)
        if (selectedDescriptiveName === fileData.filename) {
            if (frontmatter.title && frontmatter.name) {
                selectedDescriptiveName = frontmatter.title + " " + frontmatter.name
            }
            else if (frontmatter.name) {
                selectedDescriptiveName = frontmatter.name
            } else if (frontmatter.campaign && frontmatter.sessionNumber) {
                selectedDescriptiveName = frontmatter.campaign + " " + frontmatter.sessionNumber
            }
        }

        let displayDefaults = this.getDisplayData(frontmatter)
        let defArt = ""
        let indefArt = ""

        if ("indefArt" in displayDefaults) {
            indefArt = displayDefaults.indefArt ?? ""
        } else {
            indefArt = this.#getIndefArt(selectedDescriptiveName)
        }


        if ("defArt" in displayDefaults) {
            defArt = displayDefaults.defArt ?? ""
        } else {
            defArt = this.#getDefArt(selectedDescriptiveName)
        }

        return {
            name: selectedDescriptiveName,
            definiteArticle: overrides.definiteArticle ?? defArt,
            indefiniteArticle: overrides.indefiniteArticle ?? indefArt,
            linkTarget: fileData.filename,
            linkText: overrides.linkText ?? this.#getLinkText(fileData.frontmatter, sourceType),
            isNormalizedName: true
        }

    }

    // This returns a "name" for either a page or a string
    getName(target, format = "", alias = undefined, linkTextOverride = undefined, sourcePageType = undefined) {

        let nameObject = this.getNameObject(target, sourcePageType, {
            alias: alias,
            linkText: linkTextOverride
        })

        return this.formatName(nameObject, format)
    }
}
