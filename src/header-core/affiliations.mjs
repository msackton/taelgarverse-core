import {HeaderDataError} from './errors.mjs';
// Maintained shared header logic. The legacy generated module remains a reference.
export class AffiliationManager {
    constructor({dates, names, records, format}) {
        Object.assign(this,{dates, names, records, format});
    }

    #getMaxPartOfDepth(filter) {
        if (filter === undefined || filter === null) return undefined

        let match = filter.toString().match(/\d+/)
        if (!match) return undefined

        return parseInt(match[0], 10)
    }

    #getPartOfChain(partOfPiece, thisDepth, filter, sourcePageType, visited = []) {

        const {names} = this;
        let maxDepth = this.#getMaxPartOfDepth(filter)
        thisDepth = thisDepth ?? 1

        let partOfItem = { name: names.getNameObject(partOfPiece, sourcePageType) }
        let file = names.getFileForTarget(partOfPiece)

        // we can't keep going, because this piece doesn't exist
        if (!file) {
            return [partOfItem]
        } else {
            if (visited.includes(file.path)) throw new HeaderDataError('organization', [...visited, file.path]);
            const nextVisited = [...visited, file.path];
            let nextPageType = names.getPageType(file.frontmatter)
            let nextLevel = file.frontmatter.partOf

            let retValue = []

            retValue.push(partOfItem)

            if (maxDepth && thisDepth >= maxDepth) {
                return retValue
            }

            if (nextPageType === sourcePageType && nextPageType !== "place" && nextLevel) {
                retValue.push(...this.#getPartOfChain(nextLevel, thisDepth + 1, filter, sourcePageType, nextVisited))
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

        const {dates} = this;
        const {names} = this;
        let minDate = dates.normalizeDate("0001", false)
        let maxDate = dates.normalizeDate("9999", true);
        defaultStart = dates.normalizeDate(defaultStart, false)

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
                startDate: dates.normalizeDate(affiliation.start, false) ?? defaultStart ?? minDate,
                endDate: dates.normalizeDate(affiliation.end, true) ?? pageDates.endDate ?? maxDate,
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

        result.name = names.getNameObject(result.org, sourcePageType)
        return result
    }

    getPrimaryAffiliations(metadata, targetDate) {
        return this.getAffiliations(metadata, targetDate).filter(f => f.type == "primary")
    }

    getNonPrimaryAffiliations(metadata, targetDate) {
        return this.getAffiliations(metadata, targetDate).filter(f => f.type != "primary")
    }

    getFormattedNonPrimaryAffiliations(metadata, targetDate) {

        const {dates} = this;
        const {names} = this;

        let displayOptions = names.getDisplayData(metadata)


        if (targetDate) targetDate = dates.normalizeDate(targetDate)
        if (!targetDate) targetDate = dates.getTargetDateForPage(metadata)

        let nonPrimary = this.getNonPrimaryAffiliations(metadata, targetDate)
        let grouped = this.#groupBy(nonPrimary, f => JSON.stringify([f.title, f.startDate.sort, f.endDate.sort, f.format, f.formatCurrent, f.formatPast]))

        let lines = []
        grouped.forEach(group => {
            function isDisplayableDate(date) {
                return date && !date.isHiddenDate
            }
            const {dates} = this;

            let first = group.at(0)
            let dateInfo = {
                startDate: first.startDate,
                endDate: first.endDate,
                isCreated: true,
                isAlive: undefined,
                age: undefined
            }

            dates.setPageDateProperties(dateInfo, targetDate)

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

            lines.push(this.format(formatStr, { frontmatter: metadata }, targetDate,
                {
                    dateInfo: dateInfo,
                    affiliationtitle: first.title,
                    // The affiliation format is the outer sentence, not a
                    // format to apply to every name inside that sentence.
                    affiliations: group.map(({format, ...member}) => member)
                }))
        })

        return lines.join("\n")
    }

    getLeadBy(target, date) {
        const at = date ? this.dates.normalizeDate(date) : this.dates.getTargetDateForPage();
        const file = this.names.getFileForTarget(target);
        const display = this.names.getDisplayData(file.frontmatter);
        const lines = [];
        for (const page of this.records(target)) {
            for (const affiliation of this.getAffiliations(page.metadata, at)) {
                if (affiliation.type !== 'leader' || affiliation.org !== target ||
                    affiliation.startDate.sort > at.sort || affiliation.endDate.sort < at.sort) continue;
                const dateInfo = {startDate:affiliation.startDate, endDate:affiliation.endDate,
                    isCreated:true, isAlive:undefined, age:undefined};
                this.dates.setPageDateProperties(dateInfo, at);
                lines.push(this.format(display.ruledBy, {name:page.name, frontmatter:page.metadata}, at,
                    {dateInfo, affiliationtitle:affiliation.title}));
            }
        }
        return lines.join('\n');
    }

    getPartOfs(metadata, filter, sourcePageType) {

        if (metadata.partOf) {
            return this.#getPartOfChain(metadata.partOf, 1, filter, sourcePageType)
        }

        return []
    }

    isOrWasAffiliated(target, personMetadata, targetDate) {
        const {names} = this;


        let affs = this.getAffiliations(personMetadata, targetDate)
        return affs.some(f => f.org == target && f.startDate.sort <= targetDate.sort)
    }

    isAffiliated(target, personMetadata, targetDate) {
        const {names} = this;


        let affs = this.getAffiliations(personMetadata, targetDate)
        return affs.some(f => f.org == target && f.startDate.sort <= targetDate.sort && targetDate.sort <= f.endDate.sort)
    }

    getAffiliations(metadata, targetDate) {

        const {dates} = this;
        const {names} = this;

        if (targetDate) targetDate = dates.normalizeDate(targetDate)
        if (!targetDate) targetDate = dates.getTargetDateForPage(metadata)

        // this does some normalizing so I can test without changing all the pages
        let affList = []

        let pageDates = dates.getPageDates(metadata, targetDate)
        let sourcePageType = names.getPageType(metadata)

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
