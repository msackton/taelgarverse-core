import {HeaderDataError} from './errors.mjs';
// Maintained shared header logic. The legacy generated module remains a reference.
export class WhereaboutsManager {
    constructor({dates, names}) {
        Object.assign(this,{dates, names});
    }

    #getNormalizedWhereabout(w) {
        const {dates} = this;

        function isValidLocPiece(l) {
            if (l == undefined) return false
            if (l == "") return false
            if (l == "unknown") return false
            return true
        }

        let endDate = dates.normalizeDate(w.end, true)
        let startDate = dates.normalizeDate(w.start, false)
        if (!startDate) startDate = dates.normalizeDate(w.date, false)

        let dateMin = dates.normalizeDate('0001', false)
        let dateMax = dates.normalizeDate('9999', true)

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
            : dates.normalizeDate(w.start, true) ?? dateMax)

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

        const {names} = this;
        let pageType = names.getPageType(targetMetadata)

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

    #getWhereaboutChainPiece(whereabout, targetDate, thisDepth, filter, sourcePageType, visited = []) {

        const {names} = this;


        if (!whereabout.location) {
            return [{
                name: names.getNameObject("Unknown", sourcePageType, { alias: whereabout.alias, linkText: whereabout.linkText }),
                format: whereabout.format
            }]
        }

        if (whereabout.location == "Taelgar") {
            // Taelgar is handling specially
            if (thisDepth > 1) return []
            if (filter.includes("r")) return []

            return [{
                name: names.getNameObject("Taelgar", sourcePageType, { alias: whereabout.alias, linkText: whereabout.linkText, linkTarget: "Gazetteer" }),
                format: whereabout.format
            }]
        }

        let file = names.getFileForTarget(whereabout.location)

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
                }, targetDate, thisDepth, filter, sourcePageType, visited)
            }

            return [{
                name: names.getNameObject(whereabout.location, sourcePageType, { alias: whereabout.alias, linkText: whereabout.linkText }),
                format: whereabout.format
            }]
        }


        if (visited.includes(file.path)) throw new HeaderDataError('location', [...visited, file.path]);
        const nextVisited = [...visited, file.path];
        let pageType = names.getPageType(file.frontmatter)
        let nameSection = names.getNameObject(whereabout.location, sourcePageType, { alias: whereabout.alias, linkText: whereabout.linkText })
        let nextLevelCheck = this.#shouldAllowPiece(filter, thisDepth, file.frontmatter)

        let nextDepth = nextLevelCheck.incrementDepth ? thisDepth + 1 : thisDepth
        let nextWb = this.getWhereabouts(file.frontmatter, targetDate)
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
            returnValue.push(...this.#getWhereaboutChainPiece(nextLevel, targetDate, nextDepth, filter, pageType, nextVisited))
        }

        return returnValue
    }

    getWhereaboutChain(startWhereabout, targetDate, filter, sourcePageType) {

        return this.#getWhereaboutChainPiece(startWhereabout, targetDate, 1, filter, sourcePageType)
    }

    getWhereaboutsList(metadata) {
        const {names} = this;

        if (metadata && metadata.whereabouts && metadata.whereabouts.length > 0) {
            let wb = metadata.whereabouts
            if (typeof metadata.whereabouts === 'string' || metadata.whereabouts instanceof String) {
                wb = [{ type: "home", location: metadata.whereabouts }]
            }

            return wb.map(f => this.#getNormalizedWhereabout(f))
            // backwards compatability //
            // if place has partOf but no whereabouts, use partOf for whereabouts //
        } else if (metadata && names.getPageType(metadata) == "place") {
            let wb = [{ type: "home", location: metadata.partOf }]
            return wb.map(f => this.#getNormalizedWhereabout(f))
        }

        return []
    }

    getWhereabouts(metadata, targetDate) {
        const {dates} = this;

        targetDate = dates.normalizeDate(targetDate)
        if (!targetDate) targetDate = dates.getTargetDateForPage(metadata)

        // default to unknown //
        let unknownWhereabout = { location: null }
        let whereaboutResult = { current: unknownWhereabout, home: unknownWhereabout, origin: unknownWhereabout, lastKnown: unknownWhereabout, secondary: unknownWhereabout }

        let originDate = dates.normalizeDate(metadata.born, false) ?? dates.normalizeDate(metadata.created, false) ?? dates.normalizeDate("0001", false)
        let normalized = this.getWhereaboutsList(metadata)

        // home is lexically last valid home //
        whereaboutResult.home = this.#filterWhereabouts(normalized, "home", targetDate, false, true).at(-1) ?? whereaboutResult.home
        // origin is lexically first valid home //
        whereaboutResult.origin = this.#filterWhereabouts(normalized, "home", originDate, false, true).at(0) ?? whereaboutResult.origin
        // secondary is the lexically last valid secondary
        whereaboutResult.secondary = this.#filterWhereabouts(normalized, "secondary", targetDate, false, true).at(-1) ?? whereaboutResult.secondary
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
}
