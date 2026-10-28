class OutputHandler {

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
