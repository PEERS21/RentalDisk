// src/lib/fetches.tsx
import { useEffect, useState } from 'react';
import {StaticImageData} from "next/image";
import logo from "@/public/images/logo.svg";
import dayjs, { Dayjs } from "dayjs";

export type OccupiedRange = { start: string; end: string };

export type DiskItem = {
    id: number;
    img_filename: string;
    client_img_filename: string;
    name: string;
    company: string;
    content: string;
    categories: number[];
    title: string;
};

export const DEFAULT_DISK_ITEM: DiskItem = {
    id: -1,
    img_filename: "logo.svg",
    client_img_filename: "logo.svg",
    name: 'Loading...',
    company: 'Loading...',
    content: 'Loading...',
    categories: [1],
    title: 'Loading...',
};

// Hook для клиентского использования
export function useDisks(url = "/api/items") {
    const [data, setData] = useState<DiskItem[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<Error | null>(null);

    useEffect(() => {
        let aborted = false;
        setLoading(true);
        setError(null);

        fetch(url)
            .then((res) => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json();
            })
            .then((json) => {
                if (!aborted) {
                    setData(json as DiskItem[]);
                    setLoading(false);
                }
            })
            .catch((err) => {
                if (!aborted) {
                    setError(err as Error);
                    setLoading(false);
                }
            });

        return () => {
            aborted = true;
        };
    }, [url]);

    console.info(data);

    return { data, loading, error };
}

type TimeView = "hours" | "minutes" | "seconds"; // используемый тип в MUI

export function useOccupiedRanges(dateForDay: Dayjs | null, diskId?: number) {
    const [occupied, setOccupied] = useState<OccupiedRange[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!dateForDay) {
            setOccupied([]);
            return;
        }
        // Форматируем дату как YYYY-MM-DD
        const dayStr = dateForDay.format("YYYY-MM-DD");
        let cancelled = false;
        setLoading(true);

        (async () => {
            try {
                const q = new URL("/api/occupied_times", window.location.origin);
                q.searchParams.set("date", dayStr);
                if (diskId) q.searchParams.set("disk_id", String(diskId));

                const resp = await fetch(q.toString(), { credentials: "include" });
                if (!resp.ok) {
                    console.warn("Failed to load occupied times", resp.status);
                    if (!cancelled) setOccupied([]);
                    return;
                }
                const json = await resp.json();
                if (!cancelled) setOccupied(json.occupied || []);
            } catch (err) {
                console.warn("Error fetching occupied times", err);
                if (!cancelled) setOccupied([]);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();

        return () => { cancelled = true; };
    }, [dateForDay?.format("YYYY-MM-DD"), diskId]);

    return { occupied, loading };
}

