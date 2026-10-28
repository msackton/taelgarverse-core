class AffiliationManager {

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

            let first = group.first()
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

}
