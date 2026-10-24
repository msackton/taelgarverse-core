// Maintained shared header logic. The legacy generated module remains a reference.
export class OutputHandler {
    constructor({dates, names, locations, templates, affiliations, events}) {
        Object.assign(this,{dates, names, locations, templates, affiliations, events});
    }

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

        if (headerType === "static") data = this.generateHeader(fileName, metadata)
        else if (headerType === "website") data = this.generateWebsiteHeader(fileName, metadata)

        // remove the header block
        currentContents.splice(indexOfYamlEnd + 1, indexOfHeaderBlockEnd - indexOfYamlEnd);
        // insert the template
        currentContents.splice(indexOfYamlEnd + 1, 0, data);

        // rewrite the file
        return currentContents
    }

    generateWebsiteHeader(fileName, metadata, {includeTitle=true}={}) {
        const {events, names, templates, dates} = this;

        let file = { name: fileName, frontmatter: metadata }
        let displayDefaults = names.getDisplayData(metadata)
        let pageDates = dates.getPageDates(metadata)
        let hasPageDates = pageDates.startDate || pageDates.endDate
        let pageType = names.getPageType(metadata)

        let output = includeTitle ? templates.formatDisplayString("# <name:tn>", file) + "\n" : ""
        let whereaboutsStrings = this.getWhereaboutsStrings(fileName, metadata)
        let boxInfo = templates.formatDisplayString(displayDefaults.boxInfo, file).trim()
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
            let secondary = templates.formatDisplayString("<pronunciation>", file)
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
                let line = this.outputPageDatedValue(fileName, metadata).trim()
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
                let line = this.outputPageDatedValue(fileName, metadata).trim()
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
                let line = this.outputPageDatedValue(fileName, metadata).trim()
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
                let line = this.outputPageDatedValue(fileName, metadata).split("\n")
                for (let l of line) {
                    if (l.trim()) {
                        hasData = true
                        output += "    " + l.trim() + "  \n"
                    }
                }
            }

            let line = this.outputAffiliations(fileName, metadata).split("\n")
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

        for (let meeting of events.getPartyMeeting(file)) {
            output += `%%^Campaign:${meeting.campaign}%%\n`
            output += "\n:octicons-location-24:{ .lg .middle } " + meeting.text + "  \n"
            output += "%%^End%%\n"
        }

        return output
    }

    generateHeader(fileName, metadata, {includeTitle=true}={}) {

        const {events, names, templates, dates} = this;

        let file = { name: fileName, frontmatter: metadata }
        let displayDefaults = names.getDisplayData(metadata)
        let pageDates = dates.getPageDates(metadata)
        let hasPageDates = pageDates.startDate || pageDates.endDate
        let pageType = names.getPageType(metadata)

        let output = includeTitle ? templates.formatDisplayString("# <name:tn>", file) + "\n" : ""

        let secondary = templates.formatDisplayString("<(*()pronunciation()*)>", file)
        if (secondary && secondary.length > 0) {
            output += secondary + "\n"
        }

        let summaryBlockLines = []

        let boxInfo = templates.formatDisplayString(displayDefaults.boxInfo, file)
        if (boxInfo && boxInfo.length > 0) {
            summaryBlockLines.push("> " + boxInfo)
        }

        if (metadata.ddbLink && displayDefaults.mechanicsLink && displayDefaults.mechanicsLink.length > 0) {
            summaryBlockLines.push("> [" + displayDefaults.mechanicsLink + "](" + metadata.ddbLink + ")")
        }

        if (hasPageDates) {
            const lines = this.outputPageDatedValue(fileName, metadata).split("\n");
            for (const line of lines) summaryBlockLines.push("> " + line);
        }

        if (metadata.leaderOf || metadata.affiliations || pageType === "place" || pageType === "group" || pageType === "object") {

            const lines = this.outputAffiliations(fileName, metadata).split("\n");
            for (const line of lines) summaryBlockLines.push("> " + line);
        }

        let partOf = templates.formatDisplayString(displayDefaults.partOf, file)
        if (partOf && partOf.length > 0) {
            summaryBlockLines.push("> " + partOf)
        }

        if (metadata.whereabouts) {
            const lines = this.outputWhereabouts(fileName, metadata).split("\n");
            for (const line of lines) if (line.trim()) summaryBlockLines.push("> >" + line.trim());
        }

        for (let meeting of events.getPartyMeeting(file)) {
            summaryBlockLines.push(`> > %%^Campaign:${meeting.campaign}%% ${meeting.text} %%^End%%`);
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

        const {locations} = this;
        const {dates} = this;
        const {names} = this;
        const {templates} = this;

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

        let displayDefaults = names.getDisplayData(pageMetadata)
        let file = { name: fileName, frontmatter: pageMetadata }

        let pageData = dates.getPageDates(pageMetadata);
        let pageYear = dates.getTargetDateForPage(pageMetadata)

        if (!pageData.isCreated) return strVals;

        let isPageAlive = pageData.isAlive

        // if page is dead/destroyed, get whereabouts as of died/destroyed date //
        // if we want to allow dead bodies to move around, would need to change this //
        // however, currently don't have a good location to track "Died at" so might be complicated //
        // but commenting to track for the future //
        if (!isPageAlive) pageYear = pageData.endDate

        let whereabout = locations.getWhereabouts(pageMetadata, pageYear)

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

            dates.setPageDateProperties(dateInfo, pageYear)

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

            dates.setPageDateProperties(dateInfo, pageYear)

            originOverrides = {
                dateInfo: dateInfo
            }
        }

        // origin string construction //
        // if origin is unknown, use unknown string //
        // don't care about alive/dead for origin //
        let originString = templates.formatDisplayString(whereabout.origin.location ? (whereabout.origin.originFormat ?? displayDefaults.wOrigin) : displayDefaults.wOriginU, file, pageYear, originOverrides)

        // home string construction //
        if (isPageAlive) {
            homeString = templates.formatDisplayString(whereabout.home.location ? (whereabout.home.homeFormat ?? displayDefaults.wHome) : displayDefaults.wHomeU, file, pageYear, homeOverrides)
        } else {
            homeString = templates.formatDisplayString(whereabout.home.location ? (whereabout.home.pastHomeFormat ?? displayDefaults.wPastHome) : displayDefaults.wPastHomeU, file, pageYear, homeOverrides)
        }

        // current string construction //
        let currentString = templates.formatDisplayString((isPageAlive ? (whereabout.current.currentFormat ?? displayDefaults.wCurrent) : (whereabout.current.pastFormat ?? displayDefaults.wPast)), file, pageYear)

        // last known string construction //
        let knownString = templates.formatDisplayString(knownLastKnown ? (whereabout.lastKnown.lastKnownFormat ?? displayDefaults.wLastKnown) : (whereabout.lastKnown.lastKnownFormat ?? displayDefaults.wLastNoDate), file, pageYear)


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
            strVals.secondary = templates.formatDisplayString(whereabout.secondary.secondaryFormat ?? displayDefaults.wSecondary, file, pageYear)
        } else {
            strVals.secondary = ""
        }

        // remove extra newlines //
        return strVals;
    }

    outputAffiliations(fileName, metadata) {
        const {affiliations} = this;

        let leadBy = affiliations.getLeadBy(fileName)
        return (leadBy + "\n" + affiliations.getFormattedNonPrimaryAffiliations(metadata)).trim()
    }

    outputPageDatedValue(fileName, metadata) {
        function isDisplayableDate(date) {
            return date && !date.isHiddenDate
        }

        const {dates} = this;
        const {templates} = this;
        const {names} = this;

        let frontmatter = metadata?.file?.frontmatter ?? metadata ?? {}
        let dateInfo = dates.getPageDates(metadata)
        let pageDisplayData = names.getDisplayData(frontmatter)
        let pageType = names.getPageType(frontmatter)
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

        return templates.formatDisplayString(formatStr, { name: fileName, frontmatter: metadata })

    }
}
