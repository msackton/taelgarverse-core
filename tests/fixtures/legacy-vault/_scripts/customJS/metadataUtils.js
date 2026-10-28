class util {

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
