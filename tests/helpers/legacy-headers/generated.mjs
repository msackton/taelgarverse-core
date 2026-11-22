// Generated from trusted vault CustomJS. No runtime evaluation or global prototype changes.
export const headerRevision = "661c012727b13bdc084ad4e9f661aed2b73f1f748cd2a696509c5eb5a0b42ddc";
export function instantiate({customJS,app}) {
  const window = {app};
  const console = {log(){},warn(){},error(){}};
  customJS.DateManager = new (class DateManager {

    DR_MONTHS = {
        1: 'January',
        2: 'February',
        3: 'March',
        4: 'April',
        5: 'May',
        6: 'June',
        7: 'July',
        8: 'August',
        9: 'September',
        10: 'October',
        11: 'November',
        12: 'December'
    }

    #getNameForMonth(month) {
        return this.DR_MONTHS[month]
    }

    setPageDateProperties(pageDates, targetDate) {

        if (pageDates.startDate) {
            pageDates.isCreated = pageDates.startDate.sort <= targetDate.sort;
        } else {
            pageDates.isCreated = true
        }

        if (pageDates.endDate) {
            pageDates.isAlive = pageDates.endDate.sort >= targetDate.sort;
        } else {
            pageDates.isAlive = pageDates.isCreated
        }

        if (pageDates.startDate) {
            if (pageDates.isAlive) {
                pageDates.age = targetDate.days - pageDates.startDate.days
            }
            else if (pageDates.endDate) {
                pageDates.age = pageDates.endDate.days - pageDates.startDate.days
            }
        }
    }

    #getPageDateSource(metadata) {
        const frontmatter = metadata?.file?.frontmatter
        if (!frontmatter) return metadata ?? {}

        const pageDateKeys = ["born", "died", "created", "destroyed", "DR", "DR_end", "pageTargetDate"]
        const hasPageDateFrontmatter = pageDateKeys.some(key => Object.prototype.hasOwnProperty.call(frontmatter, key))

        return hasPageDateFrontmatter ? frontmatter : (metadata ?? frontmatter)
    }

    getPageDates(metadata, targetDate) {

        let dateMetadata = this.#getPageDateSource(metadata)

        if (!targetDate) targetDate = this.getTargetDateForPage(dateMetadata)

        let status = {
            startDate: undefined,
            endDate: undefined,
            isCreated: undefined,
            isAlive: undefined,
            age: undefined
        }

        let useDR = true;
        if ("born" in dateMetadata || "died" in dateMetadata || "created" in dateMetadata || "destroyed" in dateMetadata) {
            useDR = false;
        }

        // Determine page type (when available) to avoid misclassifying non-events as ended when only DR is present
        let pageType = "unknown";
        try {
            const { NameManager } = customJS;
            pageType = NameManager.getPageType(dateMetadata) ?? "unknown";
        } catch (e) {
            // If NameManager isn't available in this context, fall back to generic behavior
        }

        if (dateMetadata.born) {
            status.startDate = this.normalizeDate(dateMetadata.born, false);
        } else if (dateMetadata.created) {
            status.startDate = this.normalizeDate(dateMetadata.created, false);
        } else if (dateMetadata.DR && useDR) {
            status.startDate = this.normalizeDate(dateMetadata.DR, false);
        }

        if (dateMetadata.died) {
            status.endDate = this.normalizeDate(dateMetadata.died, true);
        } else if (dateMetadata.destroyed) {
            status.endDate = this.normalizeDate(dateMetadata.destroyed, true);
        } else if ("DR_end" in dateMetadata && useDR) {
            // this is to allow a blank DR_end to mean "unknown"
            if (dateMetadata.DR_end) status.endDate = this.normalizeDate(dateMetadata.DR_end, true);
        } else if (dateMetadata.DR && useDR && pageType == "event") {
            // Only treat a lone DR as an end date for event-type pages.
            // For people/places/groups, a single DR should not imply the page has ended.
            status.endDate = this.normalizeDate(dateMetadata.DR, true);
        }

        this.setPageDateProperties(status, targetDate)

        return status;
    }


    getTargetDateForPage(metadata) {
        let dateMetadata = this.#getPageDateSource(metadata)

        if (customJS.state.overrideDate) {
            return this.normalizeDate(customJS.state.overrideDate, false);
        }

        if (dateMetadata && dateMetadata.pageTargetDate) {
            return this.normalizeDate(dateMetadata.pageTargetDate, false);
        }

        if (window.FantasyCalendarAPI == undefined || window.FantasyCalendarAPI.getCalendars().length == 0) {
            const calendarAPI = Calendarium.getAPI("Taelgar");
            const currentDate = calendarAPI.getCurrentDate(); // this is an object { year: number, month: number, day: number }
            return this.normalizeDate( {year: currentDate.year, month: currentDate.month, day: currentDate.day}, false);
        }

        return this.normalizeDate(window.FantasyCalendarAPI.getCalendars()[0].current, false);
    }

    // DR counts from the 291st day of the 4132nd year in the Dwarven count
    // The 4132nd year of the dwarven calendar started on March 17th the year before Drankor was founded
    // March 17 - Jan 1 is 290 days. Easier to not include DR 1/1/1 in the count so we don't have to correct later
    // So DR 1/1/1 = (4132*365) + 291 but we want DROneDays to be the day before 1/1/1

    DROneDays = (4132 * 365) + 290

    #getDayInMonth(month) {
        switch (month) {
            case 1: return 31
            case 2: return 28
            case 3: return 31
            case 4: return 30
            case 5: return 31
            case 6: return 30
            case 7: return 31
            case 8: return 31
            case 9: return 30
            case 10: return 31
            case 11: return 30
            case 12: return 31
        }
    }

    #getDaysSinceCreation(year, month, day) {
        // this assumes DR for now
        // this is the day before Jan 1, 1 DR
        let days = this.DROneDays

        // DR 1 is included in drOneDays, so we don't want to add anything for it
        days += ((year - 1) * 365) + day

        if (month > 1) days += this.#getDayInMonth(1)
        if (month > 2) days += this.#getDayInMonth(2)
        if (month > 3) days += this.#getDayInMonth(3)
        if (month > 4) days += this.#getDayInMonth(4)
        if (month > 5) days += this.#getDayInMonth(5)
        if (month > 6) days += this.#getDayInMonth(6)
        if (month > 7) days += this.#getDayInMonth(7)
        if (month > 8) days += this.#getDayInMonth(8)
        if (month > 9) days += this.#getDayInMonth(9)
        if (month > 10) days += this.#getDayInMonth(10)
        if (month > 11) days += this.#getDayInMonth(11)

        return days
    }

    #getDisplayForDaysSinceCreation(daysSinceCreation, dateFormat) {

         let convertedDays = 0

        if (dateFormat == "DR") {
            convertedDays = daysSinceCreation - this.DROneDays
        } else if (dateFormat == "CY") {
            convertedDays = daysSinceCreation
        }

        let year = Math.ceil(convertedDays / 365)
        let day = 0
        let month = 0
        let remaining = convertedDays - ((year - 1) * 365)

        // DR calculation //

        if (dateFormat == "DR") {
            for (let mCount = 1; mCount <= 12; mCount++) {
                let daysInThisMonth = this.#getDayInMonth(mCount)
                if (remaining <= daysInThisMonth) {
                    day = remaining
                    month = mCount
                    break
                }

                remaining -= daysInThisMonth
            }
          
            let dayString = day + "th"
            if (day % 100 < 11 || day % 100 > 13) {
                if (day % 10 == 1) dayString = day + "st"
                else if (day % 10 == 2) dayString = day + "nd"
                else if (day % 10 == 3) dayString = day + "rd"
            }

            return this.#getNameForMonth(month) + " " + dayString + ", " + year
        }


        // CY calculation //

        if (dateFormat == "CY") {
        
            // each block of 73 days is 2 months (35 days each) plus 3 intercalary days

            let block = Math.ceil(remaining/73)
            let remainingInBlock = remaining - ((block - 1) * 73)
            // month is block-1 * 2 + Math.ceil(remainingInBlock/35)    				
            let intercalDays = remainingInBlock > 70 ? remainingInBlock - 70 : 0            
            remainingInBlock = remainingInBlock - intercalDays
            let blockPart = Math.ceil(remainingInBlock/35)            
            month = ((block - 1) * 2) + blockPart
            let extraDays = remainingInBlock - ((blockPart-1) * 35)
            let dayString = extraDays.toString().padStart(2,"0")
            if (intercalDays) {
                dayString = extraDays.toString().padStart(2,"0") + "." + intercalDays.toString()
            }
            return "CY " + year.toString() + "-" + month.toString().padStart(2,"0") + "-" + dayString 
        }

    }

    normalizeDate(inputDate, isEnd) {

        if (inputDate == undefined) return undefined;
        if (inputDate == "") return undefined;

        let isString = typeof inputDate === 'string' || inputDate instanceof String

        if (!isString && inputDate.isNormalizedDate) return inputDate

        let year = 0, month = 0, days = 0
        let isHiddenDate = false
        let display = undefined

        if (isString) {
            // this is a string which we expect is either yyyy-mm-dd or yyyy-mm but something is wrong, most likely the actual year is not 4 digits
            let splitString = inputDate.split("-")
            if (splitString.length == 3) {
                year = parseInt(splitString[0])
                month = parseInt(splitString[1])
                days = parseInt(splitString[2])
            }
            else if (splitString.length == 2) {
                year = parseInt(splitString[0])
                month = parseInt(splitString[1])
                days = isEnd ? 1 : this.#getDayInMonth(month)
                display = this.#getNameForMonth(month) + " " + splitString[0];

            } else if (splitString.length == 1) {

                year = parseInt(splitString[0])
                month = isEnd ? 1 : 12
                days = isEnd ? 1 : 31
                display = "DR " + inputDate
                isHiddenDate = year == 1 || year == 9999

            } else {
                console.log("Unexpected incoming string: " + inputDate)
                return undefined
            }
        } else {

            switch (typeof (inputDate)) {
                case "number": {
                    year = inputDate
                    if (isEnd) {
                        month = 12
                        days = 31
                    } else {
                        month = 1
                        days = 1
                    }
                    display = "DR " + inputDate
                    isHiddenDate = year == 1 || year == 9999
                    break
                }
                case "object": {
                    if (inputDate.year == undefined) {
                        return undefined;
                    }

                    if (inputDate.isLuxonDateTime) {
                        year = inputDate.year
                        month = inputDate.month ?? (isEnd ? 12 : 1)
                        days = inputDate.day ?? (isEnd ? this.#getDayInMonth(month) : 1)
                    } else {
                        // fantasy calendar, zero-counts months, add one
                        year = inputDate.year
                        month = (inputDate.month + 1) ?? (isEnd ? 12 : 1)
                        days= inputDate.day ?? (isEnd ? this.#getDayInMonth(month) : 1)
                    }
                }
            }
        }

        if (year === 0) return undefined

        let daysSinceCreate = this.#getDaysSinceCreation(year, month, days)

        return { display: display ?? this.#getDisplayForDaysSinceCreation(daysSinceCreate, "DR"), sort: daysSinceCreate, year: year, days: daysSinceCreate, isNormalizedDate: true, isHiddenDate: isHiddenDate };        
    }

}
)();
  customJS.NameManager = new (class NameManager {

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
)();
  customJS.WhereaboutsManager = new (
class WhereaboutsManager {

    #getNormalizedWhereabout(w) {
        const { DateManager } = customJS

        function isValidLocPiece(l) {
            if (l == undefined) return false
            if (l == "") return false
            if (l == "unknown") return false
            return true
        }

        let endDate = DateManager.normalizeDate(w.end, true)
        let startDate = DateManager.normalizeDate(w.start, false)
        if (!startDate) startDate = DateManager.normalizeDate(w.date, false)

        let dateMin = DateManager.normalizeDate('0001', false)
        let dateMax = DateManager.normalizeDate('9999', true)

        let type = w.type

        // set location to null unless w.location is a non-empty string //
        let location = null
        if ((w?.location?.trim() ?? "").length > 0) {
            location = w.location
        }

        if (type == "primary") { type = "home" }
      
        if (!location) {
            let hasPlace = isValidLocPiece(w.place)
            let hasRegion = isValidLocPiece(w.region)

            if (hasPlace && hasRegion) location = w.place + ", " + w.region
            else if (hasPlace) location = w.place
            else if (hasRegion) location = w.region
        }
        // end backwards compatability //

        let logicalEnd = endDate ?? dateMax
        let logicalStart = startDate ?? dateMin
        let awayEnd = endDate ?? (type == "home" || type == "secondary" ? dateMax
            : DateManager.normalizeDate(w.start, true) ?? dateMax)

        return {
            start: startDate,
            type: type,
            end: endDate,
            location: location,
            alias: w.alias,
            logicalEnd: logicalEnd,
            logicalStart: logicalStart,
            linkText: w.linkText,
            awayEnd: awayEnd,
            startFilter: w.startFilter,
            format: w.format,

            // these should generally not be used - might go away
            pastHomeFormat: w.pastHome ?? w.wPastHome ?? w.pastHomeFormat,
            homeFormat: w.home ?? w.wHome ?? w.homeFormat,
            originFormat: w.origin ?? w.wOrigin ?? w.originFormat,
            currentFormat: w.current ?? w.wCurrent ?? w.currentFormat,
            lastKnownFormat: w.lastKnown ?? w.wLastKnown ?? w.lastKnownFormat,
            pastFormat: w.past ?? w.wPast ?? w.pastFormat
        }
    }

    #get_distance_to_target(item, target) {
        if (item.logicalEnd.sort < target.sort) {
            return target.days - item.logicalEnd.days
        }
        else return target.days - item.logicalStart.days
    }

    #filterWhereabouts(whereaboutsList, type, target, allowPast, allowUnknown) {
        // filter whereaboutsList to only those that are valid for target //
        // if allowPast is true, will include past locations //
        // if allowUnknown is true, will include unknown locations //
        let candidateSet = whereaboutsList
            .filter(w => ((!type && w.type != "secondary") || w.type == type) && (w.logicalStart.sort <= target.sort))
            .filter(w => allowPast || target.sort <= w.logicalEnd.sort)
            .filter(w => allowUnknown || w.location);
        let soonestPossible = Math.min(...candidateSet.map(w => this.#get_distance_to_target(w, target)))
        return candidateSet.filter(w => this.#get_distance_to_target(w, target) == soonestPossible)
    }


    #shouldAllowPiece(formatStr, currentDepth, targetMetadata) {
        /*** 
            R = include regions only; r = exclude regions (i.e. places with typeOf region)
            L = include locations only; l = exclude locations
            P = include people only; p = exclude people
            I = include items only; p = exclude items
            F = include first step only; f = exclude first step
            O = include groups only; o = exclude groups
         */

        let successResult = {
            continue: true,
            allowed: true,
            incrementDepth: true
        }

        let depthFilterFailed = {
            continue: true,
            allowed: false,
            incrementDepth: true
        }

        let typeFilterFailed = {
            continue: true,
            allowed: false,
            incrementDepth: false
        }

        const { NameManager } = customJS
        let pageType = NameManager.getPageType(targetMetadata)

        let maxDepth = undefined
        let minDepth = undefined

        if (!formatStr) return successResult

        let fsSplit = formatStr.split('-')

        if (fsSplit.length == 2) {
            // we have something like xxx-yyyy
            // the number has to be first, as that is what parseInt expects, that is, parseInt(2ttt) returns 2 but parseInt(ttt2) returns undefined

            minDepth = parseInt(fsSplit[0])
            maxDepth = parseInt(fsSplit[1])
        } else {
            maxDepth = parseInt(formatStr)
        }

        if (minDepth && currentDepth < minDepth) {
            // we are before the min depth, continue without this, but increment
            return depthFilterFailed
        }

        if (formatStr.includes("F")) {
            if (currentDepth == 1) return successResult
        }

        if (formatStr.includes("f")) {
            if (currentDepth == 1) return depthFilterFailed
        }

        if (formatStr.includes("r")) {
            if (targetMetadata.typeOf == "region") return typeFilterFailed
        }

        if (formatStr.includes("R")) {
            if (targetMetadata.typeOf != "region") return typeFilterFailed
        }

        if (formatStr.includes("L")) {
            if (pageType != "place") return typeFilterFailed
        }

        if (formatStr.includes("l")) {
            if (pageType == "place") return typeFilterFailed
        }

        if (formatStr.includes("P")) {
            if (pageType != "person") return typeFilterFailed
        }

        if (formatStr.includes("p")) {
            if (pageType == "person") return typeFilterFailed
        }

        if (formatStr.includes("I")) {
            if (pageType != "object") return typeFilterFailed
        }

        if (formatStr.includes("i")) {
            if (pageType == "object") return typeFilterFailed
        }

        if (formatStr.includes("O")) {
            if (pageType != "group") return typeFilterFailed
        }

        if (formatStr.includes("o")) {
            if (pageType == "group") return typeFilterFailed
        }

        // this has to be last, or we allow types that are at the max depth but are the wrong kind
        if (maxDepth && currentDepth >= maxDepth) {
            // we have reached the max depth, don't continue but do include this one
            return { continue: false, allowed: true }
        }


        return successResult
    }


    #getWhereaboutChainPiece(whereabout, targetDate, thisDepth, filter, sourcePageType) {

        const { NameManager } = customJS
        const { WhereaboutsManager } = customJS

        if (!whereabout.location) {
            return [{
                name: NameManager.getNameObject("Unknown", sourcePageType, { alias: whereabout.alias, linkText: whereabout.linkText }),
                format: whereabout.format
            }]
        }

        if (whereabout.location == "Taelgar") {
            // Taelgar is handling specially
            if (thisDepth > 1) return []
            if (filter.includes("r")) return []

            return [{
                name: NameManager.getNameObject("Taelgar", sourcePageType, { alias: whereabout.alias, linkText: whereabout.linkText, linkTarget: "Gazetteer" }),
                format: whereabout.format
            }]
        }

        let file = NameManager.getFileForTarget(whereabout.location)

        // we can't keep going, because this piece doesn't exist
        if (!file) {
            // lets see if we have a match to our capital letter check
            let match = new RegExp("[~A-Z]{1}").exec(whereabout.location)
            if (match && match.index > 0) {
                let potentialNextPiece = whereabout.location.substring(match.index)
                return this.#getWhereaboutChainPiece({
                    location: potentialNextPiece,
                    linkText: whereabout.location.substring(0, match.index),
                    alias: whereabout.alias,
                    format: whereabout.format ?? "<name:q>" // this is a bit of a hack, because it means we ignore other format params, but the link text is critical here
                }, targetDate, thisDepth, filter, sourcePageType)
            }

            return [{
                name: NameManager.getNameObject(whereabout.location, sourcePageType, { alias: whereabout.alias, linkText: whereabout.linkText }),
                format: whereabout.format
            }]
        }


        let pageType = NameManager.getPageType(file.frontmatter)
        let nameSection = NameManager.getNameObject(whereabout.location, sourcePageType, { alias: whereabout.alias, linkText: whereabout.linkText })
        let nextLevelCheck = this.#shouldAllowPiece(filter, thisDepth, file.frontmatter)

        let nextDepth = nextLevelCheck.incrementDepth ? thisDepth + 1 : thisDepth
        let nextWb = WhereaboutsManager.getWhereabouts(file.frontmatter, targetDate)
        let nextLevel = nextWb.current
        let returnValue = []

        if (nextLevelCheck.allowed) {
            // this piece is allowed, add it //
            let data = {}
            data.name = nameSection
            data.format = whereabout.format

            for (let key in file.frontmatter) {
                if (key == "name" || key == "whereabouts" || key == "affiliations" || key == "leaderOf") continue
                data[key] = file.frontmatter[key]
            }

            returnValue.push(data)
        }

        if (nextLevelCheck.continue && nextLevel && nextLevel.location) {
            // we are allowed to continue, and we have somewhere to go //                            
            returnValue.push(...this.#getWhereaboutChainPiece(nextLevel, targetDate, nextDepth, filter, pageType))
        }

        return returnValue
    }


    getWhereaboutChain(startWhereabout, targetDate, filter, sourcePageType) {

        return this.#getWhereaboutChainPiece(startWhereabout, targetDate, 1, filter, sourcePageType)
    }


    getWhereaboutsList(metadata) {
        const { NameManager } = customJS

        if (metadata && metadata.whereabouts && metadata.whereabouts.length > 0) {
            let wb = metadata.whereabouts
            if (typeof metadata.whereabouts === 'string' || metadata.whereabouts instanceof String) {
                wb = [{ type: "home", location: metadata.whereabouts }]
            }

            return wb.map(f => this.#getNormalizedWhereabout(f))
            // backwards compatability // 
            // if place has partOf but no whereabouts, use partOf for whereabouts //
        } else if (metadata && NameManager.getPageType(metadata) == "place") {
            let wb = [{ type: "home", location: metadata.partOf }]
            return wb.map(f => this.#getNormalizedWhereabout(f))
        }

        return []
    }

    getWhereabouts(metadata, targetDate) {
        const { DateManager } = customJS

        targetDate = DateManager.normalizeDate(targetDate)
        if (!targetDate) targetDate = DateManager.getTargetDateForPage(metadata)

        // default to unknown //
        let unknownWhereabout = { location: null }
        let whereaboutResult = { current: unknownWhereabout, home: unknownWhereabout, origin: unknownWhereabout, lastKnown: unknownWhereabout, secondary: unknownWhereabout }

        let originDate = DateManager.normalizeDate(metadata.born, false) ?? DateManager.normalizeDate(metadata.created, false) ?? DateManager.normalizeDate("0001", false)
        let normalized = this.getWhereaboutsList(metadata)

        // home is lexically last valid home //
        whereaboutResult.home = this.#filterWhereabouts(normalized, "home", targetDate, false, true).at(-1) ?? whereaboutResult.home
        // origin is lexically first valid home //
        whereaboutResult.origin = this.#filterWhereabouts(normalized, "home", originDate, false, true).at(0) ?? whereaboutResult.origin
        // secondary is the lexically last valid secondary
        whereaboutResult.secondary = this.#filterWhereabouts(normalized, "secondary", originDate, false, true).at(0) ?? whereaboutResult.secondary
        // current is lexically last valid location //
        whereaboutResult.current = this.#filterWhereabouts(normalized, undefined, targetDate, false, true).at(-1) ?? whereaboutResult.current
        // lastknown is assumed to be current for now //
        whereaboutResult.lastKnown = whereaboutResult.current

        if (whereaboutResult.current.location && targetDate.sort > whereaboutResult.current.awayEnd.sort) {
            // our current location is our best guess as to our location, but we are not still there //
            whereaboutResult.current = unknownWhereabout
        }

        if (!whereaboutResult.lastKnown.location) {
            // lastknown is unknown, see if we can find a better one //
            whereaboutResult.lastKnown = this.#filterWhereabouts(normalized, undefined, targetDate, true, false).at(-1) ?? unknownWhereabout
        }
        return whereaboutResult
    }
})();
  customJS.TokenParser = new (class TokenParser {

    debug = false

    // Define the allowable filter and format characters
    // unused characters: bB cC dD eE gG hH jJ K mM N S T vV wW X Y zZ 

    // * format definitions * //
    /*** 
        t: title case; s: lower case, u: initial upper case, k: keep case 
            (keep case doesn't do anything in name manager, but it makes writing a string like :k;t, to make the first element title cased and the rest normal a lot easier)
        a: indefinite article, A: indefinite article if first, x: no definite article, q: preposition if different, Q: no preposition; v: preposition always
        n: never link, y: always link        
    ***/

    formatChars = "dqQaAxnytsUukv";
    casingChars = "tsUu";

    // * filter definitions * //
    /*** 
        R = include regions only; r = exclude regions (i.e. places with typeOf region)
        L = include locations only; l = exclude locations
        P = include people only; p = exclude people
        I = include items only; i = exclude items
        F = include first step always; f = exclude first step
        O = include groups only; o = exclude groups
    ***/

    filterChars = "rRpPlLiIoOfF";

    // defines a regex for parsing tokens //

    tokenRegex = /<(\(.*?\))?([a-zA-Z]+):?([^:()\s<>]+?)?(\(.*?\))?>/g;

    #parseTokenString(input, isFirst) {
        // isFirst allows for special handling of certain format specifiers which need to be conditional on the value being the first in the chain //

        // from https://stackoverflow.com/questions/50649912/remove-duplicate-character-in-string-and-make-unique-string
        const remDup = e => [...new Set(e)].sort().join("");

        function checkStringChars(inputString, allowedChars) {
            return Array.from(inputString).every(char => allowedChars.includes(char));
        }

        let tokenRegex = this.tokenRegex
        let filterChars = this.filterChars
        let formatChars = this.formatChars

        // extracts format and filter strings from the token string
        // Initial structure of the result
        let token = {
            token: null,
            prefix: null,
            suffix: null,
            filter: null,
            format: null, // format for the item, or if a chain, for all items in a chain
            firstFormat: null, // override format applied to first format in the chain only
            fullTokenText: input
        };

        // parse the prefix, suffix, token, and format
        let tokenMatches = [...input.matchAll(tokenRegex)];
        // if there is more than one match, don't process the token
        let tokenMatch = tokenMatches.length === 1 ? tokenMatches[0] : null;
        // match1 is the prefix, match2 is the token, match3 is the filter/format, match4 is the suffix
        if (tokenMatch) {
            token.prefix = tokenMatch[1]?.slice(1, -1) ?? "";
            token.suffix = tokenMatch[4]?.slice(1, -1) ?? "";
            token.token = tokenMatch[2] ?? "";

            // parse filterFormat string //

            let filterFormatString = tokenMatch[3]?.split(";");

            // Separate filter and format based on allowable characters
            let filter = "";
            let format = "";
            let firstFormat = null; // we want to explicitly distinguish between null/undefined and t; (where t; means, t is the format, nothing is the first format)

            if (filterFormatString) {
                // Check for a numerical range or limit at the beginning of the filter //
                let rangeRegex = /^(\d+-\d+|\d+-|-?\d+)/;
                let rangeMatch = filterFormatString[0].match(rangeRegex) ?? "";
                if (rangeMatch) {
                    // If a range is present, add it to filter and move on //
                    filter += rangeMatch[0];
                    // Remove the range from the filter string
                    filterFormatString[0] = filterFormatString[0].substring(rangeMatch[0].length);
                }

                // a single string is interpreted as a filter+format string
                // a string that has two parts (a;b) can be either
                //      a filter;format string
                //      a format;firstFormat string
                // a string that has three parts (a;b;c) is interpreted as a filter;format;firstFormat string

                if (filterFormatString.length === 1) {
                    // we just have a string, what is it?
                    // parse it as a filter + format string
                    for (let char of filterFormatString[0]) {
                        if (filterChars.includes(char)) filter += char;
                        if (formatChars.includes(char)) format += char;
                    }
                } else if (filterFormatString.length === 2) {
                    // we have a;b; need to first check if a is a filter or a format
                    if (checkStringChars(filterFormatString[0], filterChars)) {
                        // part a is a filter, part b is a format
                        filter += filterFormatString[0];
                        format = filterFormatString[1];
                    } else if (checkStringChars(filterFormatString[0], formatChars)) {
                        // part a is a format, part b is a firstFormat
                        format = filterFormatString[0];
                        firstFormat = filterFormatString[1];
                    } else {
                        // this is an error, if we get here then a is neither a filter nor a format
                        // we will return null and the token will be ignored
                        return token;
                    }
                } else if (filterFormatString.length === 3) {
                    firstFormat = ""
                    // we have a;b;c
                    // a is filter, b is the format, c is firstFormat
                    for (let char of filterFormatString[0]) {
                        if (filterChars.includes(char)) filter += char;
                    }
                    for (let char of filterFormatString[1]) {
                        if (formatChars.includes(char)) format += char;
                    }
                    for (let char of filterFormatString[2]) {
                        if (formatChars.includes(char)) firstFormat += char;
                    }
                }


                token.filter = remDup(filter);
                token.format = remDup(format);
                token.firstFormat = firstFormat == null ? null : remDup(firstFormat);
            }

        };

        // clean up tokens //
        // target, targetdate, and currentdate are all the same thing
        if (token.token == "target" || token.token == "currentdate") token.token = "targetdate"
        // length and age are the same //
        if (token.token == "length") token.token = "age"
        // end is shorthand for endStatus //
        if (token.token == "end" || token.token == "endStatus") token.token = "endstatus"
        // start is shorthand for startStatus //
        if (token.token == "start" || token.token == "startStatus") token.token = "startstatus"
        // subtype is the same as subtypeof //
        if (token.token == "subtype") token.token = "subtypeof"
        // typeof and type are the same as maintype //        
        if (token.token == "type") token.token = "typeof"


        if (token.format?.includes("U") && isFirst) {
            token.format = token.format.replace("U", "u")
        } else {
            token.format = token.format?.replace("U", "")
        }

        if (token.format?.includes("A") && isFirst) {
            token.format = token.format.replace("A", "a")
        } else {
            token.format = token.format?.replace("A", "")
        }

        // all tokens are lower case //
        token.token = token.token.toLowerCase()

        return token

        // complicated regex kept as a comment for reference //

        // this is a complicated regex, but basically it is 6 groups:
        //      first, prefix: contained in (), any letters or spaces
        //      second, token: letters only
        //      third, filter: digit-digit, plus filter options
        //      fourth, first item format string: the standard format string options. Can be separated from the filter with an optional semi-colon
        //      fifth, the all item format string: the standard format string options. Must be separated from the filter with a semi colon
        //      sixth, suffix: contained in (), any letters or spaces
        // const regexp = /<(\([()a-zA-Z-:*\s]+\))?([a-zA-Z]+):?([0-9]*[-]?[0-9]*[RrPpLlIiOoFf!]*)?;?([UutsaAnyxqQ]+)?;?([UutsaAnyxqQ]+)?(\([()a-zA-Z-:*\s]+\))?>/g; 
        // 
        // 
        // if (((input || '').match(regexp) || []).length !== 1) {
        //    return null;
        // }
        //
        // let match = regexp.exec(input)
        // if (match) {
        //    token.prefix = match[1] ?? ""
        //    token.token = match[2] ?? ""
        //    token.filter = match[3] ?? ""
        //    token.format = match[4] ?? ""
        //    token.chainFormat = match[5] ?? match[4] ?? ""
        //    token.suffix = match[6] ?? ""
        //}

    }

    #getParameterCaseInsensitive(object, key) {
        // get case insensitive parameter from object
        const asLowercase = key.toLowerCase();
        return object[Object.keys(object)
            .find(k => k.toLowerCase() === asLowercase)
        ];
    }

    #getFormattedCaseString(value, token) {
        // this is something that can never be meaningfully linked
        // and never has an article
        // but which might need casing rules

        const { NameManager } = customJS;

        // this probably just returns itself, but...
        let name = { name: value, linkText: "", indefiniteArticle: "", definiteArticle: "", linkTarget: undefined }

        return NameManager.formatName(name, token.format)
    }


    #getFormattedName(value, token) {
        // returns a formatted name
        // pass the format and the name to the name manager to generate a formatted name
        const { NameManager } = customJS;

        return NameManager.formatName(value, token.format)
    }

    #getWhereaboutChain(whereabout, targetDate, filter, sourcePageType) {

        const { WhereaboutsManager } = customJS

        // returns a formatted location chain
        let followDate = targetDate

        // if the away end date of the whereabout is before the target date, use that as the follow date
        if (whereabout.awayEnd && targetDate && whereabout.awayEnd.sort < targetDate.sort) {
            followDate = whereabout.awayEnd
        }

        return WhereaboutsManager.getWhereaboutChain(whereabout, followDate, whereabout.startFilter ?? filter, sourcePageType)
    }

    #getFormattedList(value, token, targetDate, joinChar, lastJoinChar) {
        if (!Array.isArray(value)) return ""

        let results = []
        let index = 0;

        let finalStr = ""
        let prevLinkText = ""

        for (let item of value) {

            let formatStr = (index++ === 0 && token.firstFormat != null) ? token.firstFormat : token.format
            if (!formatStr) formatStr = ""

            if (item.format === null || item.format === undefined) {
                if (formatStr.includes("q")) {                    
                    if (item.name.linkText == prevLinkText) {
                        item.name.linkText = ""
                    } else {
                        prevLinkText = item.name.linkText
                    }
                }
            }
            

            results.push(this.formatDisplayString(item.format ?? "<name:" + formatStr + ">", {}, targetDate, item))
        }


        for (index = 0; index < results.length; index++) {
            let remaining = results.length - index - 1 // we want to exclude this item, i.e. if we are the last item we want remaining to be 0

            if (remaining > 1)
                finalStr += results[index] + joinChar
            else if (remaining == 1)
                finalStr += results[index] + lastJoinChar
            else
                finalStr += results[index]
        }

        return finalStr
    }

    #getFormattedWhereaboutList(value, token, targetDate) {
        return this.#getFormattedList(value, token, targetDate, ", ", ", ")
    }

    #getFormattedPartOfList(value, token) {
        return this.#getFormattedList(value, token, undefined, ", ", ", ")
    }

    #getFormattedAffiliationList(value, token) {
        return this.#getFormattedList(value, token, undefined, ", ", ", and ")
    }

    #getFormattedDate(value, token) {

        const { DateManager } = customJS;

        // returns a formatted date
        // right now this just normalizes the date and returns the display value
        value = DateManager.normalizeDate(value)
        if (value.isHiddenDate) return ""
        return value.display
    }

    #getFormattedAge(value, token) {
        
        if (value >= (365 * 2)) {
            let years = Math.floor(value / 365)            
            return years + " years"
        } else if (value > 30) {
            return Math.floor(value/(365/12)) + " months"        
        } else if (value > 1) {
            return value + " days"
        } else {
            return "1 day"
        } 
    }

    #getTypeOfOrDefault(metadata) {

        if (metadata.typeOf) return metadata.typeOf
        if ("typeOf" in metadata) return ""

        if (metadata.tags && metadata.tags.length > 0) {
            let baseTag = metadata.tags.filter(f => f.startsWith("object") || f.startsWith("place") || f.startsWith("ancestry") || f.startsWith("group") || f.startsWith("person")).at(0)
            if (baseTag) {
                let value = baseTag.split("/")
                if (value.length == 2) return value[1]
                return value[0]

            }
        }

        return undefined;
    }

    #formatToken(token, file, targetDate, overrides) {

        const { NameManager } = customJS
        const { WhereaboutsManager } = customJS
        const { DateManager } = customJS
        const { AffiliationManager } = customJS

        // Takes a token object and returns a formatted string

        // reused from https://stackoverflow.com/questions/171251/how-can-i-merge-properties-of-two-javascript-objects-dynamically

        function merge_options(obj1, obj2) {
            var obj3 = {};
            if (obj1) for (var attrname in obj1) { obj3[attrname] = obj1[attrname]; }
            if (obj2) for (var attrname in obj2) { obj3[attrname] = obj2[attrname]; }
            return obj3;
        }

        // overrides that are used elsewhere //
        // overrides.dateInfo replaces the dateInfo object that is computed by DateManager //

        let metadata = merge_options(file.frontmatter, overrides)

        // prevent undefined ref errors below
        if (!overrides) overrides = {}

        if (targetDate) targetDate = DateManager.normalizeDate(targetDate)
        let pageDateInfo = metadata.dateInfo ?? DateManager.getPageDates(metadata, targetDate)
        let displayDefaults = NameManager.getDisplayData(metadata)
        let sourcePageType = NameManager.getPageType(metadata)

        let value = "";

        // default formatter is none, if we don't set something specific //
        let formatter = "none"

        switch (token.token) {
            // date formatter - value is expected to be a normalizedDate object //
            case "startdate":
                if (pageDateInfo.startDate) value = pageDateInfo.startDate
                formatter = "date"
                break;
            case "targetdate":
                value = targetDate ? targetDate : DateManager.getTargetDateForPage(metadata)
                formatter = "date"
                break;
            case "enddate":
                if (pageDateInfo.endDate) value = pageDateInfo.endDate
                formatter = "date"
                break;
            case "lastknowndate":
                let wb = WhereaboutsManager.getWhereabouts(metadata, targetDate)
                if (wb.lastKnown.location && wb.lastKnown.awayEnd.sort <= targetDate.sort) {
                    value = wb.lastKnown.awayEnd
                } else {
                    if (targetDate) {
                        value = targetDate
                    } else {
                        value = DateManager.getTargetDateForPage(metadata)
                    }
                }
                formatter = "date"
                break;

            // age formatter - currenty just adds year or years to integer, but allows more complicated options in the future
            case "age":
                value = pageDateInfo.age
                formatter = "age"
                break;

            // name formatter - value is expected to be a name object //
            case "name":
                // this is a special case; we want to use the metadata name only if it is overridden
                // usually we prefer the merged data, but in this case, we want the name only if it represents 
                // an override
                value = NameManager.getNameObject(overrides.name ?? file.name, sourcePageType)
                formatter = "name"
                break;
            case "ancestry":
            case "subtypeof":
            case "subspecies":
            case "species":
            case "person":
                let valueFromMetadata = this.#getParameterCaseInsensitive(metadata, token.token)
                let possibleAliasKey = token.token + "alias"
                let alias = this.#getParameterCaseInsensitive(metadata, possibleAliasKey)

                value = valueFromMetadata ? NameManager.getNameObject(valueFromMetadata, sourcePageType, { alias: alias }) : ""
                formatter = "name"
                break
            case "typeof":
                let typeOf = this.#getTypeOfOrDefault(metadata)
                value = typeOf ? NameManager.getNameObject(typeOf, sourcePageType, { alias: metadata.typeOfAlias }) : ""
                formatter = "name"
                break
            case "maintype":
                // special case where we define a specific main type based on metadata //
                if (metadata.species) {
                    token.token = "species"
                    return this.#formatToken(token, file, targetDate, overrides)
                } else {
                    token.token = "typeof"
                    return this.#formatToken(token, file, targetDate, overrides)
                }
            // end name options //  

            // whereabout-list formatter - value is expected to be a whereabout chain //
            case "current":
                value = this.#getWhereaboutChain(WhereaboutsManager.getWhereabouts(metadata, targetDate).current, targetDate, token.filter, sourcePageType)
                formatter = "whereabout-list"
                break
            case "lastknown":
                value = this.#getWhereaboutChain(WhereaboutsManager.getWhereabouts(metadata, targetDate).lastKnown, targetDate, token.filter, sourcePageType)
                formatter = "whereabout-list"
                break
            case "home":
                value = this.#getWhereaboutChain(WhereaboutsManager.getWhereabouts(metadata, targetDate).home, targetDate, token.filter, sourcePageType)
                formatter = "whereabout-list"
                break      
            case "origin":
                targetDate = pageDateInfo.startDate ?? DateManager.normalizeDate("0001")
                value = this.#getWhereaboutChain(WhereaboutsManager.getWhereabouts(metadata, targetDate).origin, targetDate, token.filter, sourcePageType)
                formatter = "whereabout-list"
                break
            case "secondary":
                value = this.#getWhereaboutChain(WhereaboutsManager.getWhereabouts(metadata, targetDate).secondary, targetDate, token.filter, sourcePageType)
                formatter = "whereabout-list"
                break
            // end whereabout options //

            // affiliation-list formatter - value is expected to be a list of affiliations //
            case "primary":
                value = metadata.primaryAffiliations ?? AffiliationManager.getPrimaryAffiliations(metadata, targetDate)
                formatter = "affiliation-list"
                break
            case "affiliations":
                // this is a bit of a hack, but we can't just look at the metadata.affiliations as that will always be true
                value = (metadata.affiliations && Array.isArray(metadata.affiliations) && metadata.affiliations.some(f => f.name?.isNormalizedName === true)) ? metadata.affiliations : AffiliationManager.getAffiliations(metadata, targetDate)
                formatter = "affiliation-list"
                break
            case "nonprimary":
                value = metadata.nonPrimaryAffiliations ?? AffiliationManager.getNonPrimaryAffiliations(metadata, targetDate)
                formatter = "affiliation-list"
                break
            // end affiliation options //

            // partof-list formatter - value is expected to be a list of partofs
            case "partof":
                // currently we just use the affliation manager here to get a fully formatted string
                value = AffiliationManager.getPartOfs(metadata, token.filter, sourcePageType)
                formatter = "partof-list"
                break;
            // end partof options //                

            // various complicated options //
            case "ka":
                // ka is unusual because we want to link the word 'ka' to the page for the ka
                // but we don't want to link the number
                if (metadata.species != "elf" && !metadata.ka) {
                    value = ""
                }
                else {
                    value = this.#getFormattedName(NameManager.getNameObject("ka"), token) + " " + (metadata.ka ?? "unknown")
                }
                formatter = "none"
                break;
            case "population":
                // could have its own formatter but for now just keep this in the switch
                if (metadata.population) {
                    let intPop = parseInt(metadata.population)
                    if (intPop) value = "pop. " + metadata.population.toLocaleString()
                    else value = metadata.population
                }
                formatter = "none"
                break;

            case "pronunciation":
                value = metadata.pronunciation
                formatter = "none"
                break;

            case "pronouns":
                // calculate pronouns from gender if not specified
                if (metadata.pronouns) value = metadata.pronouns
                else if (metadata.gender == "male") value = "he/him"
                else if (metadata.gender == "female") value = "she/her"
                else if (metadata.gender) value = "they/them"
                formatter = "casing"
                break;
            // end complicated options //

            default:
                // if no special processing, check to see if it is a key in metadata, or failing that, displayDefaults
                let metaString = this.#getParameterCaseInsensitive(metadata, token.token) ?? ""
                let displayDefaultString = this.#getParameterCaseInsensitive(displayDefaults, token.token) ?? ""
                // default formatter is casing
                if (metaString) { 
                    value = NameManager.getNameObject(metaString, sourcePageType)
                    formatter = "name"
                }
                else if (displayDefaultString) {
                    value = displayDefaultString
                    formatter = "casing"
                }
                else {
                    value = ""
                    formatter = "none"
                }
        }
        if (this.debug) console.log(value)
        if (this.debug) console.log("Formatter: " + formatter)

        // if we don't have a value, return
        if (value && (value.isNormalizedDate && value.isHiddenDate)) return ""
        if (value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0))
            return ""

        // apply casing format only to prefix and suffix //
        // uses format, not firstFormat, which might not be ideal //
        // could wrap in a function and pass either format or firstFormat //

        let casingFormat = token.format ?? ""
        casingFormat = casingFormat.split('').filter(char => this.casingChars.includes(char)).join('');
        if (casingFormat) {
            token.prefix = this.#getFormattedCaseString(token.prefix, { format: casingFormat })
            token.suffix = this.#getFormattedCaseString(token.suffix, { format: casingFormat })
        }

        let finalStr = token.prefix
        if (formatter == "name") {
            finalStr += this.#getFormattedName(value, token, metadata)
        } else if (formatter == "date") {
            finalStr += this.#getFormattedDate(value, token, targetDate, metadata)
        } else if (formatter === "casing") {
            finalStr += this.#getFormattedCaseString(value, token)
        } else if (formatter == "affiliation-list") {
            finalStr += this.#getFormattedAffiliationList(value, token)
        } else if (formatter == "whereabout-list") {
            finalStr += this.#getFormattedWhereaboutList(value, token, targetDate)
        } else if (formatter == "partof-list") {
            finalStr += this.#getFormattedPartOfList(value, token, targetDate)
        } else if (formatter == "age") {
            finalStr += this.#getFormattedAge(value, token)
        } else {
            finalStr += value
        }

        finalStr += token.suffix
        return finalStr.trim();

    }

    formatDisplayString(input, file, targetDate, overrides) {

        function cleanUpResultString(resultString) {
            // Normalize spaces (collapse multiple spaces to one) and trim the string
            resultString = resultString.replace(/\s+/g, ' ').trim();

            // Remove occurrences of `*( )*` and `( )` (with any number of spaces inside the parentheses)
            resultString = resultString.replace(/\*\(\s*\)\*|\(\s*\)/g, '');

            // Clean up spaces around parentheses
            resultString = resultString.replace(/\(\s+/g, '(').replace(/\s+\)/g, ')');

            // Trim leading and trailing commas and colons
            resultString = resultString.replace(/^[:\s,]+|[:\s,]+$/g, '');

            return resultString;
        }

        if (!input) return ""

        if (this.debug) console.log("Formatting display string: " + input);

        let formattedString = '';
        let lastIndex = 0;

        for (let tokenMatch of input.matchAll(this.tokenRegex)) {
            let tokenStartIndex = input.indexOf(tokenMatch[0], lastIndex);

            // Append the part of the string before the current token
            formattedString += input.substring(lastIndex, tokenStartIndex);
            let isFirst = (formattedString.trim().length === 0);
            if (this.debug) console.log("Token match: " + tokenMatch[0] + ", current string:" + formattedString + ", which is " + isFirst);

            let token = this.#parseTokenString(tokenMatch[0], isFirst);
            if (this.debug) console.log(token);
            let tokenValue = token ? this.#formatToken(token, file, targetDate, overrides) ?? "" : "(invalid token: " + tokenMatch[0].replace("<", "[").replace(">", "]") + ")";
            if (this.debug) console.log("Formatted value:" + tokenValue + ";");

            formattedString += tokenValue;
            lastIndex = tokenStartIndex + tokenMatch[0].length;
        }

        formattedString += input.substring(lastIndex);

        return cleanUpResultString(formattedString);
    }

}
)();
  customJS.AffiliationManager = new (class AffiliationManager {

    #getMaxPartOfDepth(filter) {
        if (filter === undefined || filter === null) return undefined

        let match = filter.toString().match(/\d+/)
        if (!match) return undefined

        return parseInt(match[0], 10)
    }

    #getPartOfChain(partOfPiece, thisDepth, filter, sourcePageType) {

        const { NameManager } = customJS
        let maxDepth = this.#getMaxPartOfDepth(filter)
        thisDepth = thisDepth ?? 1

        let partOfItem = { name: NameManager.getNameObject(partOfPiece, sourcePageType) }
        let file = NameManager.getFileForTarget(partOfPiece)

        // we can't keep going, because this piece doesn't exist
        if (!file) {
            return [partOfItem]
        } else {
            let nextPageType = NameManager.getPageType(file.frontmatter)
            let nextLevel = file.frontmatter.partOf

            let retValue = []

            retValue.push(partOfItem)

            if (maxDepth && thisDepth >= maxDepth) {
                return retValue
            }

            if (nextPageType === sourcePageType && nextPageType !== "place" && nextLevel) {
                retValue.push(...this.#getPartOfChain(nextLevel, thisDepth + 1, filter, sourcePageType))
            }

            return retValue
        }
    }

    #groupBy(list, keyGetter) {
        const map = new Map();
        list.forEach((item) => {
            const key = keyGetter(item);
            const collection = map.get(key);
            if (!collection) {
                map.set(key, [item]);
            } else {
                collection.push(item);
            }
        });
        return map;
    }

    #normalizeAffiliation(affiliation, pageDates, pageTitle, defaultStart, sourcePageType) {

        const { DateManager } = customJS
        const { NameManager } = customJS
        let minDate = DateManager.normalizeDate("0001", false)
        let maxDate = DateManager.normalizeDate("9999", true);
        defaultStart = DateManager.normalizeDate(defaultStart, false)

        let result = undefined

        if (typeof affiliation === 'string' || affiliation instanceof String) {
            result =
            {
                startDate: defaultStart ?? minDate,
                endDate: pageDates.endDate ?? maxDate,
                org: affiliation,
            }
        }
        else {
            result =
            {
                startDate: DateManager.normalizeDate(affiliation.start, false) ?? defaultStart ?? minDate,
                endDate: DateManager.normalizeDate(affiliation.end, true) ?? pageDates.endDate ?? maxDate,
                org: affiliation.org,
                type: affiliation.type,
                title: affiliation.title,
                format: affiliation.format ?? affiliation.aNoDate,
                formatPast: affiliation.formatPast ?? affiliation.aPast ?? affiliation.aPastWithStart,
                formatCurrent: affiliation.formatCurrent ?? affiliation.aCurrent
            }
        }

        if (!result.org && affiliation.place) {
            // this came from leaderOf
            result.org = affiliation.place
            if (!result.type) result.type = "leader"
        }

        if (result.type == "leader" && !affiliation.title) {
            result.title = pageTitle
        }

        if (!result.type) result.type = "member"
        if (!result.title) result.title = result.type

        result.name = NameManager.getNameObject(result.org, sourcePageType)
        return result
    }

    getPrimaryAffiliations(metadata, targetDate) {
        return this.getAffiliations(metadata, targetDate).filter(f => f.type == "primary")
    }

    getNonPrimaryAffiliations(metadata, targetDate) {
        return this.getAffiliations(metadata, targetDate).filter(f => f.type != "primary")
    }

    getFormattedNonPrimaryAffiliations(metadata, targetDate) {

        const { TokenParser } = customJS
        const { DateManager } = customJS
        const { NameManager } = customJS

        let displayOptions = NameManager.getDisplayData(metadata)


        if (targetDate) targetDate = DateManager.normalizeDate(targetDate)
        if (!targetDate) targetDate = DateManager.getTargetDateForPage(metadata)

        let nonPrimary = this.getNonPrimaryAffiliations(metadata, targetDate)
        let grouped = this.#groupBy(nonPrimary, f => f.title + "_" + f.startDate.sort + "_" + f.endDate.sort + "_" + f.format)

        let lines = []
        grouped.forEach(group => {
            function isDisplayableDate(date) {
                return date && !date.isHiddenDate
            }
            const { DateManager } = customJS

            let first = group.at(0)
            let dateInfo = {
                startDate: first.startDate,
                endDate: first.endDate,
                isCreated: true,
                isAlive: undefined,
                age: undefined
            }

            DateManager.setPageDateProperties(dateInfo, targetDate)

            let formatStr = displayOptions.aNoDate

            if (first.format || first.format === "") {
                formatStr = first.format
            } else if (first.formatPast && first.formatCurrent) {
                formatStr = dateInfo.isAlive ? first.formatCurrent : first.formatPast
            }
            else if (isDisplayableDate(dateInfo.startDate) && isDisplayableDate(dateInfo.endDate)) {
                formatStr = dateInfo.isAlive ? displayOptions.aCurrent : displayOptions.aPastHasStart
            } else if (isDisplayableDate(dateInfo.startDate)) {
                // we have a start but no end
                formatStr = dateInfo.isAlive ? displayOptions.aCurrent : displayOptions.aNoDate
            } else if (isDisplayableDate(dateInfo.endDate)) {
                formatStr = dateInfo.isAlive ? displayOptions.aNoDate : displayOptions.aPast
            } else {
                formatStr = displayOptions.aNoDate
            }

            lines.push(TokenParser.formatDisplayString(formatStr, { frontmatter: metadata }, targetDate,
                {
                    dateInfo: dateInfo,
                    affiliationtitle: first.title,
                    affiliations: group
                }))
        })

        return lines.join("\n")
    }

    getLeadBy(thing, targetDate) {
        // this gets the leaders of a target

        const { NameManager } = customJS
        const { DateManager } = customJS
        const { TokenParser } = customJS

        if (targetDate) targetDate = DateManager.normalizeDate(targetDate)
        else targetDate = DateManager.getTargetDateForPage()

        let file = NameManager.getFileForTarget(thing)

        let displayData = NameManager.getDisplayData(file.frontmatter)

        let leaderAffs = window.app.plugins.plugins.dataview.api.pages().flatMap(f => {
            return this.getAffiliations(f).map(affItem => { return { file: f, aff: affItem } })
        }).where(a => a.aff.type == "leader" && a.aff.org == thing && a.aff.startDate.sort <= targetDate.sort && a.aff.endDate.sort >= targetDate.sort)

        let lines = []

        for (let aff of leaderAffs) {
            if (aff.aff.type == "leader") {

                let dateInfo = {
                    startDate: aff.aff.startDate,
                    endDate: aff.aff.endDate,
                    isCreated: true,
                    isAlive: undefined,
                    age: undefined
                }

                DateManager.setPageDateProperties(dateInfo, targetDate)


                lines.push(TokenParser.formatDisplayString(displayData?.ruledBy, { name: aff.file.file.name, frontmatter: aff.file }, targetDate,
                    {
                        dateInfo: dateInfo,
                        affiliationtitle: aff.aff.title,
                    }))
            }
        }

        return lines.join("\n")
    }


    getPartOfs(metadata, filter, sourcePageType) {

        if (metadata.partOf) {
            return this.#getPartOfChain(metadata.partOf, 1, filter, sourcePageType)
        }

        return []
    }



    getAffiliationPartOf(metadata, format) {

        if (metadata.partOf) {
            return this.#getPartOfChain(metadata.partOf, undefined, 0, undefined, format)
        }

        return ""
    }

    isOrWasAffiliated(target, personMetadata, targetDate) {
        const { NameManager } = customJS


        let affs = this.getAffiliations(personMetadata, targetDate)
        return affs.some(f => f.org == target && f.startDate.sort <= targetDate.sort)
    }

    isAffiliated(target, personMetadata, targetDate) {
        const { NameManager } = customJS


        let affs = this.getAffiliations(personMetadata, targetDate)
        return affs.some(f => f.org == target && f.startDate.sort <= targetDate.sort && targetDate.sort <= f.endDate.sort)
    }

    getAffiliations(metadata, targetDate) {

        const { DateManager } = customJS
        const { NameManager } = customJS

        if (targetDate) targetDate = DateManager.normalizeDate(targetDate)
        if (!targetDate) targetDate = DateManager.getTargetDateForPage(metadata)

        // this does some normalizing so I can test without changing all the pages
        let affList = []

        let pageDates = DateManager.getPageDates(metadata, targetDate)
        let sourcePageType = NameManager.getPageType(metadata)

        if (metadata.leaderOf) {
            for (let item of metadata.leaderOf) {
                let aff = this.#normalizeAffiliation(item, pageDates, metadata.title, metadata.reignStart, sourcePageType)
                if (aff.startDate.sort <= targetDate.sort) {
                    affList.push(aff)
                }
            }
        }

        if (metadata.affiliations) {
            for (let item of metadata.affiliations) {
                let aff = this.#normalizeAffiliation(item, pageDates, metadata.title, undefined, sourcePageType)
                if (aff.startDate.sort <= targetDate.sort) {
                    affList.push(aff)
                }
            }
        }

        return affList
    }

})();
  customJS.EventManager = new (class EventManager {

    getPartyMeeting(file, campaign) {

        const { TokenParser } = customJS
        const { NameManager } = customJS
        const { DateManager } = customJS
        const { WhereaboutsManager } = customJS

        let results = []

        let metadata = file?.frontmatter ?? {}
        let displayData = NameManager.getDisplayData(metadata)
        let pageType = NameManager.getPageType(metadata)

        let format = displayData?.wParty

        function normalizeCampaignInfo(value) {
            if (!value) return []
            if (Array.isArray(value)) return value
            if (typeof value === "object") return [value]
            return []
        }

        for (let element of normalizeCampaignInfo(metadata.campaignInfo).filter(e => e.campaign && e.date)) {

                let displayDate = DateManager.normalizeDate(element.date)
                if (!displayDate) continue

                let locForThisDate = WhereaboutsManager.getWhereabouts(metadata, element.date).current;

                let formatStr = element.wParty ?? element.format ?? format

                if (locForThisDate && (element.campaign == campaign || !campaign)) {
                    let partyPage = NameManager.getCampaignPartyPage(element.campaign)
                    let person = element.person ?? partyPage ?? element.campaign
                    if (person) {
                        let type = element.type ?? "seen"
                        let personName = NameManager.getNameObject(person, pageType)   
                        let text = TokenParser.formatDisplayString(formatStr, {frontmatter: metadata, file: ""}, displayDate, {met: type, person: personName, sourcePageType: pageType})
                        results.push({ text: text, campaign: element.campaign, date: displayDate, location: locForThisDate.location })
                    }
                }
        }

        return results
    }

}
)();
  customJS.OutputHandler = new (class OutputHandler {

    regenerateHeader(oldContents, fileName, metadata, headerType) {

        const versionNumber = "2023.11.25"
        const prevVersionNumber = "legacy"
        const nextVersionNumber = "2023.11.25"

        let currentContents = oldContents.split('\n');

        let version = metadata.version

        let vnToUse = versionNumber
        if (version === "next") vnToUse = nextVersionNumber
        else if (version === "old") vnToUse = prevVersionNumber


        // the end of the yaml -- this is 0-counting, so if the file is just a yaml start and end it will be 1
        let indexOfYamlEnd = currentContents.findIndex((f, i) => i > 0 && f === "---");

        if (indexOfYamlEnd > 0) {
            let yaml = currentContents.filter((v, i) => i >= 0 && i < indexOfYamlEnd)
            let headerVersionIndex = yaml.findIndex(f => f.trim().startsWith("headerVersion"))
            if (headerVersionIndex >= 0) {
                currentContents[headerVersionIndex] = "headerVersion: " + vnToUse
            } else {
                currentContents.splice(1, 0, "headerVersion: " + vnToUse)
                indexOfYamlEnd++
            }
        }

        // find the end of the header block -- the first newline (blank line) after the YAML block
        let indexOfHeaderBlockEnd = currentContents.findIndex((f, i) => i > indexOfYamlEnd && f.trim() === "");

        // the file is ONLY yaml
        if (indexOfHeaderBlockEnd === -1) {
            indexOfHeaderBlockEnd = currentContents.length;
        }

        // starting from the first newline, find the first non-newline
        let emptySpaceEnd = currentContents.findIndex((f, i) => i > indexOfHeaderBlockEnd && f.trim() !== "");
        if (emptySpaceEnd !== -1) {
            indexOfHeaderBlockEnd = emptySpaceEnd - 1
        }

        if (currentContents.slice(indexOfYamlEnd, indexOfHeaderBlockEnd).filter(f => f.trim().startsWith("#")).length === 0) {
            // there is no H1 block in the "header" so it cannot have been an actual header. 
            indexOfHeaderBlockEnd = indexOfYamlEnd
        }

        let data = ""

        if (headerType === "obs") data = this.generateHeader(fileName, metadata, true)
        else if (headerType === "static") data = this.generateHeader(fileName, metadata, false)
        else if (headerType === "website") data = this.generateWebsiteHeader(fileName, metadata)

        // remove the header block
        currentContents.splice(indexOfYamlEnd + 1, indexOfHeaderBlockEnd - indexOfYamlEnd);
        // insert the template
        currentContents.splice(indexOfYamlEnd + 1, 0, data);

        // rewrite the file
        return currentContents
    }


    generateWebsiteHeader(fileName, metadata) {
        const { EventManager, NameManager, OutputHandler, TokenParser, DateManager } = customJS

        let file = { name: fileName, frontmatter: metadata }
        let displayDefaults = NameManager.getDisplayData(metadata)
        let pageDates = DateManager.getPageDates(metadata)
        let hasPageDates = pageDates.startDate || pageDates.endDate
        let pageType = NameManager.getPageType(metadata)

        let output = TokenParser.formatDisplayString("# <name:tn>", file) + "\n"
        let whereaboutsStrings = OutputHandler.getWhereaboutsStrings(fileName, metadata)
        let boxInfo = TokenParser.formatDisplayString(displayDefaults.boxInfo, file).trim()
        const hasText = (value) => value && value.trim().length > 0
        const appendTrimmedLine = (value, prefix) => {
            if (hasText(value)) {
                output += prefix + value.trim() + "  \n"
            }
        }
        const appendRawLine = (value, prefix) => {
            if (hasText(value)) {
                output += prefix + value
            }
        }
        const hasBoxInfo = hasText(boxInfo)

        if (metadata.pronunciation) {
            let secondary = TokenParser.formatDisplayString("<pronunciation>", file)
            if (secondary && secondary.length > 0) {
                output += ":speaker:{ .middle } *(" + secondary + ")*  \n"
            }
        }

        if (pageType === "place") {
            let hasPlaces = metadata.whereabouts

            let lineCount = 0
            if (hasPageDates) lineCount++
            if (hasPlaces) lineCount++
            if (hasBoxInfo) lineCount++

            if (lineCount > 0) {
                output += "<div class=\"grid cards ext-narrow-margin ext-one-column\" markdown>\n"
                output += "-"
            }

            if (lineCount > 1) output += "  \n"

            appendTrimmedLine(boxInfo, "    :octicons-people-24: ")

            if (hasPageDates) {
                let line = OutputHandler.outputPageDatedValue(fileName, metadata).trim()
                appendTrimmedLine(line, "   :material-calendar: ")
            }

            if (hasPlaces) {
                appendTrimmedLine(whereaboutsStrings.origin, "   :octicons-location-24:{ .lg .middle } ")
                appendTrimmedLine(whereaboutsStrings.home, "    :octicons-location-24:{ .lg .middle } ")
                appendTrimmedLine(whereaboutsStrings.secondary, "    :octicons-location-24:{ .lg .middle } ")
            }

            if (lineCount > 0) {
                output += "</div>\n\n"
            }
            return output
        }

        if (pageType === "group") {
            output += "<div class=\"grid cards ext-narrow-margin ext-one-column\" markdown>\n"
            output += "-\n"

            appendTrimmedLine(boxInfo, "   :octicons-info-24:{ .lg .middle } ")

            if (hasPageDates) {
                let line = OutputHandler.outputPageDatedValue(fileName, metadata).trim()
                appendTrimmedLine(line, "   :material-calendar: ")
            }

            if (metadata.whereabouts || metadata.partOf) {
                appendTrimmedLine(whereaboutsStrings.origin, "   :octicons-location-24:{ .lg .middle } ")
                appendTrimmedLine(whereaboutsStrings.home, "    :octicons-location-24:{ .lg .middle } ")
            }

            output += "</div>\n\n"
            return output
        }


        if (pageType === "object") {
            if (!hasPageDates && !metadata.ddbLink && !metadata.whereabouts) {
                if (hasBoxInfo) {
                    output += ":octicons-info-24:{ .lg .middle } **" + boxInfo + "**  \n"
                }
                return output
            }

            output += "<div class=\"grid cards ext-narrow-margin ext-one-column\" markdown>\n"
            output += "- :octicons-info-24:{ .lg .middle } __" + boxInfo + "__  \n"

            if (hasPageDates) {
                let line = OutputHandler.outputPageDatedValue(fileName, metadata).trim()
                appendTrimmedLine(line, "   ")
            }

            if (metadata.whereabouts || metadata.partOf) {
                appendTrimmedLine(whereaboutsStrings.origin, "   ")
                appendTrimmedLine(whereaboutsStrings.home, "   ")
            }

            if (metadata.ddbLink && displayDefaults.mechanicsLink && displayDefaults.mechanicsLink.length > 0) {
                output += "    :simple-dungeonsanddragons:{ .middle} [" + displayDefaults.mechanicsLink + "](" + metadata.ddbLink + ") \n"
            }

            output += "</div>\n\n"
            // we intentionally don't return here to pickup current whereabouts and other stuff        
        }

        if (pageType === "person") {
            let hasData = false
            output += "<div class=\"grid cards ext-narrow-margin ext-one-column\" markdown>\n"
            output += "- :octicons-info-24:{ .lg .middle } __Biographical Information__\n\n"
            if (hasBoxInfo) 
            {
                hasData = true
                output += "    " + boxInfo + "  \n"
            }

            if (hasPageDates) {
                let line = OutputHandler.outputPageDatedValue(fileName, metadata).split("\n")
                for (let l of line) {
                    if (l.trim()) {
                        hasData = true
                        output += "    " + l.trim() + "  \n"
                    }
                }
            }

            let line = OutputHandler.outputAffiliations(fileName, metadata).split("\n")
            for (let l of line) {
                if (l.trim()) {
                    hasData = true
                    output += "    " + l.trim() + "  \n"
                }
            }

            if (hasData) output += "    { .bio }\n\n"

            if (metadata.whereabouts || (pageType === "place" && metadata.partOf)) {
                appendRawLine(whereaboutsStrings.origin, "    ")
                appendRawLine(whereaboutsStrings.home, "    ")
            }

            if (metadata.ddbLink && displayDefaults.mechanicsLink && displayDefaults.mechanicsLink.length > 0) {
                output += "    :simple-dungeonsanddragons:{ .middle} [" + displayDefaults.mechanicsLink + "](" + metadata.ddbLink + ") \n"
            }

            output += "</div>\n\n"
        }

        if (metadata.whereabouts) {
            if (hasText(whereaboutsStrings.current) && !whereaboutsStrings.isCurrentUnknown) {
                output += ":octicons-location-24:{ .lg .middle } " + whereaboutsStrings.current + "\n" // has 1 newline, we want 2
            } else if (hasText(whereaboutsStrings.lastKnown)) {
                output += ":octicons-location-24:{ .lg .middle } " + whereaboutsStrings.lastKnown + "\n" // has 1 newline, we want 2
            }
        }

        for (let meeting of EventManager.getPartyMeeting(file)) {
            output += `%%^Campaign:${meeting.campaign}%%\n`
            output += "\n:octicons-location-24:{ .lg .middle } " + meeting.text + "  \n"
            output += "%%^End%%\n"
        }

        return output
    }

    generateHeader(fileName, metadata, dynamic = true) {

        const { EventManager, NameManager, OutputHandler, TokenParser, DateManager } = customJS

        let file = { name: fileName, frontmatter: metadata }
        let displayDefaults = NameManager.getDisplayData(metadata)
        let pageDates = DateManager.getPageDates(metadata)
        let hasPageDates = pageDates.startDate || pageDates.endDate
        let pageType = NameManager.getPageType(metadata)

        let output = TokenParser.formatDisplayString("# <name:tn>", file) + "\n"

        let secondary = TokenParser.formatDisplayString("<(*()pronunciation()*)>", file)
        if (secondary && secondary.length > 0) {
            output += secondary + "\n"
        }

        let summaryBlockLines = []

        let boxInfo = TokenParser.formatDisplayString(displayDefaults.boxInfo, file)
        if (boxInfo && boxInfo.length > 0) {
            summaryBlockLines.push("> " + boxInfo)
        }

        if (metadata.ddbLink && displayDefaults.mechanicsLink && displayDefaults.mechanicsLink.length > 0) {
            summaryBlockLines.push("> [" + displayDefaults.mechanicsLink + "](" + metadata.ddbLink + ")")
        }

        if (hasPageDates) {

            let line = '`$=dv.view(\"_scripts/view/get_PageDatedValue\")`'
            if (!dynamic) {
                line = OutputHandler.outputPageDatedValue(fileName, metadata).split("\n")
                for (let l of line) {
                    summaryBlockLines.push("> " + l)
                }
            } else {
                summaryBlockLines.push("> " + line)
            }
        }

        if (metadata.leaderOf || metadata.affiliations || pageType === "place" || pageType === "group" || pageType === "object") {

            let line = '`$=dv.view(\"_scripts/view/get_Affiliations\")`'
            if (!dynamic) {
                line = OutputHandler.outputAffiliations(fileName, metadata).split("\n")
                for (let l of line) {
                    summaryBlockLines.push("> " + l)
                }
            } else {
                summaryBlockLines.push("> " + line)
            }
        }

        let partOf = TokenParser.formatDisplayString(displayDefaults.partOf, file)
        if (partOf && partOf.length > 0) {
            summaryBlockLines.push("> " + partOf)
        }

        if (metadata.whereabouts) {
            let line = '`$=dv.view(\"_scripts/view/get_Whereabouts\")`';
            if (!dynamic) {
                line = OutputHandler.outputWhereabouts(fileName, metadata).split("\n")
                for (let l of line) {
                    if (l.trim()) {
                        summaryBlockLines.push("> >" + l.trim())
                    }
                }
            } else {
                summaryBlockLines.push(">> " + line.trim())
            }
        }

        for (let meeting of EventManager.getPartyMeeting(file)) {
            if (!dynamic) {
                summaryBlockLines.push(`> > %%^Campaign:${meeting.campaign}%% ${meeting.text} %%^End%%`);
            } else {
                summaryBlockLines.push(`>> %%^Campaign:${meeting.campaign}%% ${meeting.text} %%^End%%`);
            }
        }

        if (summaryBlockLines.length > 0) {
            output += ">[!info]+ " + displayDefaults.boxName + "  \n"
        }


        output += summaryBlockLines.join("  \n")

        return output + "\n"
    }

    outputWhereabouts(fileName, metadata) {
        let vals = this.getWhereaboutsStrings(fileName, metadata)
        let displayString = `${vals.origin}${vals.home}${vals.current}${vals.lastKnown}`

        if (vals.secondary && vals.secondary.trim()) {
            displayString += "\n" + vals.secondary
        }

        return displayString.replace(/\n\n+/g, "\n");
    }

    getWhereaboutsStrings(fileName, metadata) {

        const { WhereaboutsManager } = customJS
        const { DateManager } = customJS
        const { NameManager } = customJS
        const { TokenParser } = customJS

        let strVals = { home: "", origin: "", lastKnown: "", current: "", isCurrentUnknown: false }
        let pageMetadata = metadata?.file?.frontmatter ?? metadata ?? {}

        // Dataview page objects include inline fields such as DR and DR_end from body text.
        // Those are timeline facts, not page lifecycle dates for whereabouts rendering.
        if (metadata?.file && !pageMetadata.tags) {
            let fileTags = metadata.file.tags ?? metadata.file.etags
            if (Array.isArray(fileTags)) {
                pageMetadata = {
                    ...pageMetadata,
                    tags: fileTags.map(t => typeof t === "string" ? t.replace(/^#/, "") : t)
                }
            }
        }

        let displayDefaults = NameManager.getDisplayData(pageMetadata)
        let file = { name: fileName, frontmatter: pageMetadata }

        let pageData = DateManager.getPageDates(pageMetadata);
        let pageYear = DateManager.getTargetDateForPage(pageMetadata)

        if (!pageData.isCreated) return strVals;

        let isPageAlive = pageData.isAlive

        // if page is dead/destroyed, get whereabouts as of died/destroyed date //
        // if we want to allow dead bodies to move around, would need to change this //
        // however, currently don't have a good location to track "Died at" so might be complicated //
        // but commenting to track for the future //
        if (!isPageAlive) pageYear = pageData.endDate

        let whereabout = WhereaboutsManager.getWhereabouts(pageMetadata, pageYear)

        let homeString = ""

        // knownLastKnown is false if either we have no awayEnd, or if the awayEnd is a hidden date (0001 or 9999)
        let knownLastKnown = whereabout.lastKnown.awayEnd && !whereabout.lastKnown.awayEnd.isHiddenDate

        let homeOverrides = undefined
        let originOverrides = undefined
        if (whereabout.home.location) {

            let dateInfo = {
                startDate: whereabout.home.start ?? pageData.startDate ?? whereabout.home.logicalStart,
                endDate: whereabout.home.end ?? pageData.endDate ?? whereabout.home.logicalEnd,
                isCreated: true,
                isAlive: undefined,
                age: undefined
            }

            DateManager.setPageDateProperties(dateInfo, pageYear)

            homeOverrides = {
                dateInfo: dateInfo
            }
        }

        if (whereabout.origin.location) {
            let dateInfo = {
                startDate: whereabout.origin.start ?? pageData.startDate ?? whereabout.origin.logicalStart,
                endDate: whereabout.origin.end ?? pageData.endDate ?? whereabout.origin.logicalEnd,
                isCreated: true,
                isAlive: undefined,
                age: undefined
            }

            DateManager.setPageDateProperties(dateInfo, pageYear)

            originOverrides = {
                dateInfo: dateInfo
            }
        }

        // origin string construction //
        // if origin is unknown, use unknown string //
        // don't care about alive/dead for origin //
        let originString = TokenParser.formatDisplayString(whereabout.origin.location ? (whereabout.origin.originFormat ?? displayDefaults.wOrigin) : displayDefaults.wOriginU, file, pageYear, originOverrides)

        // home string construction //
        if (isPageAlive) {
            homeString = TokenParser.formatDisplayString(whereabout.home.location ? (whereabout.home.homeFormat ?? displayDefaults.wHome) : displayDefaults.wHomeU, file, pageYear, homeOverrides)
        } else {
            homeString = TokenParser.formatDisplayString(whereabout.home.location ? (whereabout.home.pastHomeFormat ?? displayDefaults.wPastHome) : displayDefaults.wPastHomeU, file, pageYear, homeOverrides)
        }

        // current string construction //    
        let currentString = TokenParser.formatDisplayString((isPageAlive ? (whereabout.current.currentFormat ?? displayDefaults.wCurrent) : (whereabout.current.pastFormat ?? displayDefaults.wPast)), file, pageYear)

        // last known string construction //
        let knownString = TokenParser.formatDisplayString(knownLastKnown ? (whereabout.lastKnown.lastKnownFormat ?? displayDefaults.wLastKnown) : (whereabout.lastKnown.lastKnownFormat ?? displayDefaults.wLastNoDate), file, pageYear)


        if (!whereabout.origin.location || whereabout.origin.location != whereabout.home.location) {
            // display origin if it is not the same as home or it is unknown //
            strVals.origin = originString + "\n"
        }

        // always display home
        if (whereabout.home.location)
            strVals.home = homeString + "\n"

        if (!whereabout.current.location || whereabout.current.location != whereabout.home.location) {
            // display current if it is not the same as home or if current is unknown //
            strVals.current = currentString + "\n"
            strVals.isCurrentUnknown = !whereabout.current.location
        }

        if (!whereabout.current.location && whereabout.lastKnown.location && whereabout.lastKnown.location != whereabout.home.location) {
            // display last known if current is unknown and last known is known, as long as it isn't the same as home //        
            // note it is not clear last known can ever be same as home but this is added to just double-confirm we don't show 2x of the same thing //
            strVals.lastKnown = knownString + "\n"
        }

        if (whereabout.secondary.location) {
            strVals.secondary = TokenParser.formatDisplayString(whereabout.secondary.secondaryFormat ?? displayDefaults.wSecondary, file, pageData)
        } else {
            strVals.secondary = ""
        }

        // remove extra newlines //
        return strVals;
    }

    outputAffiliations(fileName, metadata) {
        const { AffiliationManager } = customJS

        let leadBy = AffiliationManager.getLeadBy(fileName)
        return (leadBy + "\n" + AffiliationManager.getFormattedNonPrimaryAffiliations(metadata)).trim()
    }


    outputPageDatedValue(fileName, metadata) {
        function isDisplayableDate(date) {
            return date && !date.isHiddenDate
        }

        const { DateManager } = customJS
        const { TokenParser } = customJS
        const { NameManager } = customJS

        let frontmatter = metadata?.file?.frontmatter ?? metadata ?? {}
        let dateInfo = DateManager.getPageDates(metadata)
        let pageDisplayData = NameManager.getDisplayData(frontmatter)
        let pageType = NameManager.getPageType(frontmatter)
        let hasCustomPastHasStart = Object.prototype.hasOwnProperty.call(frontmatter.displayDefaults ?? {}, "dPastHasStart")
        let hasExplicitEndDate = Object.prototype.hasOwnProperty.call(frontmatter, "DR_end") && frontmatter.DR_end
        let formatStr = ""

        if (!dateInfo.isCreated) return "**(page is future dated)**"

        if (dateInfo.isAlive) {
            if (isDisplayableDate(dateInfo.startDate)) {
                formatStr = pageDisplayData.dCurrent
            } else {
                // we have a death date in the future and displayable start date, output nothing
                return ""
            }
        }
        else if (isDisplayableDate(dateInfo.startDate) && isDisplayableDate(dateInfo.endDate)) {
            if (pageType === "event" && !hasCustomPastHasStart && (!hasExplicitEndDate || dateInfo.startDate.days === dateInfo.endDate.days)) {
                formatStr = "<startDate>"
            } else {
                formatStr = pageDisplayData.dPastHasStart
            }
        }
        else {
            formatStr = pageDisplayData.dPast
        }

        return TokenParser.formatDisplayString(formatStr, { name: fileName, frontmatter: metadata })

    }

    outputCampaignInteractions(fileName, page, campaignFilter) {
        // Intended for use from Dataview views (dv.current()) where file inlinks exist.
        // Produces a compact, stable summary so NPC pages don't need campaignInfo logs.

        const { DateManager, NameManager } = customJS

        const maxOtherMentions = 0 // 0 = no limit

        const normalizeStringList = (value) => {
            if (!value) return []
            if (Array.isArray(value)) return value.filter(v => typeof v === "string" && v.trim().length > 0)
            if (typeof value === "string" || value instanceof String) return [String(value)]
            return []
        }

        const normalizeTags = (value) => normalizeStringList(value).map(t => t.replace(/^#/, "").trim().toLowerCase())

        const getCoreCampaigns = () => {
            let campaigns = customJS?.state?.coreMeta?.campaigns
            return Array.isArray(campaigns) ? campaigns : []
        }

        const coreCampaigns = getCoreCampaigns()
        const knownTo = normalizeStringList(page?.knownTo).map(s => s.trim())

        const inlinks = page?.file?.inlinks ?? []
        if (!Array.isArray(inlinks) || inlinks.length === 0) {
            return `_No session-note links found._`
        }

        const isSessionNote = (linkedPage) => {
            if (!linkedPage?.file?.path) return false

            const tags = normalizeTags(linkedPage.tags ?? linkedPage.file?.tags ?? linkedPage.file?.etags)
            if (tags.includes("session-note")) return true

            // Fall back to configured session-note folders.
            for (let c of coreCampaigns) {
                if (c?.sessionNoteFolder && linkedPage.file.path.startsWith(c.sessionNoteFolder)) return true
            }

            // Common convention even when metadata.json isn't fully configured.
            return linkedPage.file.path.includes("/Session Notes/") || linkedPage.file.path.includes("/Sessions/")
        }

        const inferCampaignCode = (linkedPage) => {
            let path = linkedPage?.file?.path ?? ""

            for (let c of coreCampaigns) {
                if (c?.sessionNoteFolder && path.startsWith(c.sessionNoteFolder)) return (c.code ?? c.prefix)
            }

            // Session file names often end with "(DuFr)" style codes.
            let name = linkedPage?.file?.name ?? ""
            let m = name.match(/\(([^)]+)\)\s*$/)
            if (m && m[1]) {
                let cfg = NameManager.getCampaignConfig(m[1].trim())
                return cfg?.code ?? m[1].trim()
            }

            // Try any parens group if not at end.
            m = name.match(/\(([^)]+)\)/)
            if (m && m[1]) {
                let cfg = NameManager.getCampaignConfig(m[1].trim())
                return cfg?.code ?? m[1].trim()
            }

            // Fall back to campaign field if present (try to map to a known prefix).
            if (linkedPage.campaign) {
                let campaignName = String(linkedPage.campaign).trim()
                let cfg = NameManager.getCampaignConfig(campaignName)
                return cfg?.code ?? campaignName
            }

            return "Unknown"
        }

        const fmtSessionLink = (linkedPage) => {
            // Prefer a descTitle alias if present: [[Session X|Hyena Rampage]]
            let name = linkedPage?.file?.name ?? ""
            if (!name) return ""

            let alias = linkedPage?.descTitle
            if (alias && (typeof alias === "string" || alias instanceof String) && alias.trim().length > 0) {
                return `[[${name}|${alias.trim()}]]`
            }

            return `[[${name}]]`
        }

        let sessionEntries = []

        for (let link of inlinks) {
            let path = (typeof link === "string" || link instanceof String) ? String(link) : link?.path
            if (!path) continue

            let linkedPage = DataviewAPI.page(path)
            if (!linkedPage) continue
            if (!isSessionNote(linkedPage)) continue

            let campaign = inferCampaignCode(linkedPage)

            let dateRaw = linkedPage.DR ?? linkedPage.dr ?? linkedPage.DR_start ?? linkedPage.DR_end
            let date = undefined
            try {
                if (dateRaw) date = DateManager.normalizeDate(dateRaw, false)
            } catch (e) {
                date = undefined
            }

            let sort = date?.sort ?? Number.MAX_SAFE_INTEGER
            sessionEntries.push({
                campaign,
                linkedPage,
                date,
                sort
            })
        }

        if (sessionEntries.length === 0) {
            return `_No session-note links found._`
        }

        let canonicalFilter = undefined
        if (campaignFilter && (typeof campaignFilter === "string" || campaignFilter instanceof String)) {
            let cfg = NameManager.getCampaignConfig(campaignFilter)
            canonicalFilter = (cfg?.code ?? String(campaignFilter)).trim()
        }

        if (canonicalFilter) {
            sessionEntries = sessionEntries.filter(e => (e.campaign ?? "").toString().toLowerCase() === canonicalFilter.toLowerCase())
            if (sessionEntries.length === 0) return `_No session-note links found._`
        }

        // Group by campaign, then sort within each campaign.
        let byCampaign = new Map()
        for (let e of sessionEntries) {
            let key = e.campaign ?? "Unknown"
            if (!byCampaign.has(key)) byCampaign.set(key, [])
            byCampaign.get(key).push(e)
        }

        let campaignKeys = Array.from(byCampaign.keys()).sort((a, b) => String(a).localeCompare(String(b)))

        let out = ""
        for (let key of campaignKeys) {
            let entries = byCampaign.get(key) ?? []
            entries.sort((a, b) => {
                if (a.sort !== b.sort) return a.sort - b.sort
                // Stable tie-breakers.
                let an = a.linkedPage?.file?.name ?? ""
                let bn = b.linkedPage?.file?.name ?? ""
                return String(an).localeCompare(String(bn))
            })

            let first = entries[0]
            let last = entries[entries.length - 1]

            let campaignCode = String(key)

            let partyLabel = campaignCode
            try {
                let cfg = NameManager.getCampaignConfig(campaignCode)
                if (cfg?.partyPage) partyLabel = `[[${cfg.partyPage}]]`
            } catch (e) {
                // ignore
            }

            out += `### ${partyLabel}\n`

            let missingForKnownTo = !knownTo.some(x => x.toLowerCase() === campaignCode.toLowerCase())
            if (missingForKnownTo) out += `Suggested knownTo: ${campaignCode}\n`

            out += `First encountered: ${fmtSessionLink(first.linkedPage)}\n`
            if (entries.length > 1) out += `Most recent encounter: ${fmtSessionLink(last.linkedPage)}\n`

            let others = entries.slice(1, Math.max(1, entries.length - 1))
            if (entries.length > 2) {
                if (maxOtherMentions > 0) others = others.slice(Math.max(0, others.length - maxOtherMentions))

                out += "Other mentions:\n"
                for (let e of others) {
                    out += `- ${fmtSessionLink(e.linkedPage)}\n`
                }
            }

            out += "\n"
        }

        return out.trim()
    }

}
)();
  customJS.util = new (class util {

    #isInLocation(startingLocation, targetLocation, targetDate) {

        // this takes a note and a target location
        // and returns true if the note is in the starting location
        // at the target date

        // to think about: if starting location is, e.g. "wandering, north of Tokra" and target location is "Dunmar"
        // this will return false, even though it should return true

        const { NameManager } = customJS
        const { WhereaboutsManager } = customJS

        // Check for null, undefined, or empty string
        if (!startingLocation || startingLocation.trim() === "") {
            return false;
        }

        // Check if trimmed values are equal
        if (startingLocation.trim() === targetLocation.trim()) {
            return true;
        }

        // we have a single string
        let file = NameManager.getFileForTarget(startingLocation)
        if (file) {
            let nextLvl = WhereaboutsManager.getWhereabouts(file.frontmatter, targetDate)
        
            if (nextLvl) {

                // first, check to see if we are in the primary
                if (nextLvl.current.location && this.#isInLocation(nextLvl.current.location, targetLocation, targetDate)) {
                    return true
                }

                if (nextLvl.secondary.location && this.#isInLocation(nextLvl.secondary.location, targetLocation, targetDate)) {
                    return true
                }
            }
        }

        return false
    }

    age(metadata, targetDate) {
        const { DateManager } = customJS

        if (targetDate) targetDate = DateManager.normalizeDate(targetDate)
        else targetDate = DateManager.getTargetDateForPage(metadata)

        return DateManager.getPageDates(metadata, targetDate).age
    }

    isAlive(metadata, targetDate) {
        const { DateManager } = customJS

        if (targetDate) targetDate = DateManager.normalizeDate(targetDate)
        else targetDate = DateManager.getTargetDateForPage(metadata)

        return DateManager.getPageDates(metadata, targetDate).isAlive
    }

    isLinkedToPerson(file, target) {

        const { NameManager } = customJS


        let allowInlinks = NameManager.getPageType(file.frontmatter) != "place"

        if (file.outlinks) {
            if (file.outlinks.includes(target.link)) return true;
        }

        if (file.inlinks && allowInlinks) {
            if (file.inlinks.includes(target.link)) return true;
        }

        return false;
    }


    isKnownToParty(file, personMetadata, campaignPrefix, allowTag, allowSessionNotes, campaignFolder) {

        const { NameManager } = customJS

        if (personMetadata.campaignInfo) {
            if (personMetadata.campaignInfo.some(f => f.campaign.toLowerCase() == campaignPrefix.toLowerCase()))
                return true;
        }

        if (personMetadata.tags) {
            if (allowTag) {
                let campaignTags = personMetadata.tags.filter(f => f.toLowerCase().startsWith(campaignPrefix.toLowerCase()))
                if (campaignTags.some(f => !f.includes("unaware") && !f.includes("unknown") && !f.includes("unsorted")))
                    return true
            }
        }

        if (allowSessionNotes) {
            if (!campaignFolder) {
                campaignFolder = NameManager.getCampaignSessionNoteFolder(campaignPrefix)
            }

            if (campaignFolder) {
                return DataviewAPI.page(file).file.inlinks.some(f => (f?.path ?? "").startsWith(campaignFolder) || (f?.path ?? "").includes(campaignFolder))
            }
        }

        return false;
    }

    isOrWasAffiliated(target, metadata, targetDate) {

        const { AffiliationManager } = customJS
        const { DateManager } = customJS

        if (targetDate) targetDate = DateManager.normalizeDate(targetDate)
        else targetDate = DateManager.getTargetDateForPage(metadata.frontmatter)

        return AffiliationManager.isOrWasAffiliated(target, metadata.frontmatter, targetDate)
    }


    isAffiliated(target, metadata, targetDate) {

        const { AffiliationManager } = customJS
        const { DateManager } = customJS

        if (targetDate) targetDate = DateManager.normalizeDate(targetDate)
        else targetDate = DateManager.getTargetDateForPage(metadata.frontmatter)

        return AffiliationManager.isAffiliated(target, metadata.frontmatter, targetDate)
    }

    inLocation(targetLocation, metadata, includeDead, includeLastKnown, targetDate) {

        const { WhereaboutsManager } = customJS
        const { DateManager } = customJS

        if (targetDate) targetDate = DateManager.normalizeDate(targetDate)

        let pageDates = DateManager.getPageDates(metadata, targetDate)

        if (pageDates) {
            if (!pageDates.isCreated) return false
            if (!pageDates.isAlive && !includeDead) return false
        }

        let wb = WhereaboutsManager.getWhereabouts(metadata, targetDate)
        if (!wb.current.location) {

            if (!wb.lastKnown.location || !includeLastKnown) return this.#isInLocation(wb.secondary.location, targetLocation, targetDate);
            return this.#isInLocation(wb.lastKnown.location, targetLocation, targetDate) || this.#isInLocation(wb.secondary.location, targetLocation, targetDate);
        }

        return this.#isInLocation(wb.current.location, targetLocation, targetDate) || this.#isInLocation(wb.secondary.location, targetLocation, targetDate);
    }

    inOrHomeLocation(targetLocation, metadata, includeDead, targetDate) {
        return this.inLocation(targetLocation, metadata, includeDead, true, targetDate) ||
            this.homeLocation(targetLocation, metadata, includeDead, targetDate)
    }

    isLinked(target) {

        if (!target) return true

        const { NameManager } = customJS
        let file = NameManager.getFileForTarget(target)

        return file != undefined
    }


    homeLocation(targetLocation, metadata, includeDead, targetDate) {

        const { WhereaboutsManager } = customJS
        const { DateManager } = customJS

        if (targetDate) targetDate = DateManager.normalizeDate(targetDate)

        let pageDates = DateManager.getPageDates(metadata, targetDate)

        if (pageDates) {
            if (!pageDates.isCreated) return false
            if (!pageDates.isAlive && !includeDead) return false
        }


        let home = WhereaboutsManager.getWhereabouts(metadata, targetDate).home;
        if (home == undefined) return false;
        if (home.location == undefined) return false;

        return this.#isInLocation(home.location, targetLocation, targetDate)
    }

  
    s(format, targetFile, targetDate) {
        const { TokenParser } = customJS
        const { DateManager } = customJS

        if (targetDate) targetDate = DateManager.normalizeDate(targetDate)
        else targetDate = DateManager.getTargetDateForPage(targetFile.frontmatter)

        return TokenParser.formatDisplayString(format, {name: targetFile?.name ?? targetFile, frontmatter: targetFile.frontmatter}, targetDate)
    }

    originExists(metadata, targetDate) {
        const { WhereaboutsManager, DateManager } = customJS;

        // If no targetDate is provided, pick a default from the page
        if (!targetDate) {
            targetDate = DateManager.getTargetDateForPage(metadata);
        }

        let origin = WhereaboutsManager.getWhereabouts(metadata, targetDate).origin;
        if (origin == undefined) return false;
        if (origin.location == undefined) return false;
        return true;
    }

    currentLocation(metadata, targetDate) {
        const { WhereaboutsManager, DateManager } = customJS;

        // If no targetDate is provided, pick a default from the page
        if (!targetDate) {
            targetDate = DateManager.getTargetDateForPage(metadata);
        }

        let c = WhereaboutsManager.getWhereabouts(metadata, targetDate).current;
        if (c == undefined) return undefined;
        if (c.location == undefined) return undefined;
        return c.location;
    }

    originLocation(metadata, targetDate) {
        const { WhereaboutsManager, DateManager } = customJS;

        // If no targetDate is provided, pick a default from the page
        if (!targetDate) {
            targetDate = DateManager.getTargetDateForPage(metadata);
        }

        let origin = WhereaboutsManager.getWhereabouts(metadata, targetDate).origin;
        if (origin == undefined) return false;
        if (origin.location == undefined) return false;
        return origin.location;
    }

}
)();
  customJS.init = new (class init {
    normalizeCampaignRegistry(payload) {
        const entries = payload?.campaigns
        if (!entries || Array.isArray(entries) || typeof entries !== "object") {
            throw new Error("Campaign registry must contain a campaigns object")
        }

        const normalized = []
        const codes = new Set()

        for (const [slug, raw] of Object.entries(entries)) {
            if (!raw || Array.isArray(raw) || typeof raw !== "object") {
                throw new Error(`Campaign ${slug} must be an object`)
            }

            const name = String(raw.name ?? "").trim()
            const code = String(raw.code ?? "").trim()
            const campaignRoot = String(raw.campaignRoot ?? "").trim().replace(/\/$/, "")
            const notePattern = String(raw.notePattern ?? "").trim()

            if (!name || !code) {
                throw new Error(`Campaign ${slug} must define name and code`)
            }
            if (codes.has(code.toLowerCase())) {
                throw new Error(`Campaign code ${code} is duplicated`)
            }
            codes.add(code.toLowerCase())

            const lastSlash = notePattern.lastIndexOf("/")
            const relativeSessionFolder = lastSlash >= 0 ? notePattern.slice(0, lastSlash) : ""
            const sessionNoteFolder = [campaignRoot, relativeSessionFolder]
                .filter(Boolean)
                .join("/")

            normalized.push({
                ...raw,
                slug,
                name,
                code,
                aliases: Array.isArray(raw.aliases) ? raw.aliases : [],
                sessionNoteFolder
            })
        }

        return normalized
    }

    async invoke() {
        const metadataFilePath = app.vault.configDir + "/metadata.json";
        const campaignRegistryPath = "_scripts/session_note_campaigns.json";
        const [metadataFile, campaignRegistryFile] = await Promise.all([
            app.vault.adapter.read(metadataFilePath),
            app.vault.adapter.read(campaignRegistryPath)
        ])

        const coreMeta = JSON.parse(metadataFile)
        const campaignRegistry = this.normalizeCampaignRegistry(JSON.parse(campaignRegistryFile))

        // All runtime consumers receive campaign data derived from the canonical registry.
        // The legacy metadata.json list can remain temporarily for older external consumers.
        coreMeta.campaigns = campaignRegistry
        customJS.state.coreMeta = coreMeta
        customJS.state.campaignRegistry = campaignRegistry
    }
}
)();
}
