package com.dewdrop.beauty;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.IOException;

/** A nonexported, URI-granted provider for temporary camera output only. No general file access. */
public final class SelfiePhotoProvider extends ContentProvider {
    static File createPhoto(Context context) throws IOException {
        File directory = new File(context.getCacheDir(), "selfies");
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("No photo cache");
        File[] oldPhotos = directory.listFiles();
        if (oldPhotos != null) {
            for (File photo : oldPhotos) {
                if (photo.getName().matches("selfie-[A-Za-z0-9-]+\\.jpg")
                        && photo.lastModified() < System.currentTimeMillis() - 24 * 60 * 60 * 1000L) {
                    photo.delete();
                }
            }
        }
        return File.createTempFile("selfie-", ".jpg", directory);
    }

    static Uri uriForPhoto(Context context, File photo) {
        return new Uri.Builder().scheme("content").authority(context.getPackageName() + ".selfie")
            .appendPath(photo.getName()).build();
    }

    @Override public boolean onCreate() { return true; }

    private File photoForUri(Uri uri) throws FileNotFoundException {
        Context context = getContext();
        if (context == null || !"content".equals(uri.getScheme())
                || !(context.getPackageName() + ".selfie").equals(uri.getAuthority())
                || uri.getPathSegments().size() != 1 || uri.getQuery() != null
                || !uri.getLastPathSegment().matches("selfie-[A-Za-z0-9-]+\\.jpg")) {
            throw new FileNotFoundException("Invalid photo URI");
        }
        try {
            File directory = new File(context.getCacheDir(), "selfies").getCanonicalFile();
            File photo = new File(directory, uri.getLastPathSegment()).getCanonicalFile();
            if (!directory.equals(photo.getParentFile()) || !photo.isFile()) {
                throw new FileNotFoundException("Photo unavailable");
            }
            return photo;
        } catch (IOException invalid) {
            throw new FileNotFoundException("Photo unavailable");
        }
    }

    @Override public String getType(Uri uri) { return "image/jpeg"; }

    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        int access;
        if ("r".equals(mode)) access = ParcelFileDescriptor.MODE_READ_ONLY;
        else if ("w".equals(mode) || "wt".equals(mode)) {
            access = ParcelFileDescriptor.MODE_WRITE_ONLY | ParcelFileDescriptor.MODE_TRUNCATE;
        } else if ("rw".equals(mode)) access = ParcelFileDescriptor.MODE_READ_WRITE;
        else if ("rwt".equals(mode)) {
            access = ParcelFileDescriptor.MODE_READ_WRITE | ParcelFileDescriptor.MODE_TRUNCATE;
        } else throw new FileNotFoundException("Unsupported access");
        return ParcelFileDescriptor.open(photoForUri(uri), access);
    }

    @Override public Cursor query(Uri uri, String[] projection, String selection,
            String[] selectionArgs, String sortOrder) {
        try {
            File photo = photoForUri(uri);
            String[] columns = projection == null
                ? new String[] { OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE } : projection;
            MatrixCursor cursor = new MatrixCursor(columns, 1);
            Object[] values = new Object[columns.length];
            for (int i = 0; i < columns.length; i++) {
                if (OpenableColumns.DISPLAY_NAME.equals(columns[i])) values[i] = "selfie.jpg";
                else if (OpenableColumns.SIZE.equals(columns[i])) values[i] = photo.length();
            }
            cursor.addRow(values);
            return cursor;
        } catch (FileNotFoundException unavailable) { return null; }
    }

    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException(); }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] args) {
        throw new UnsupportedOperationException();
    }
    @Override public int delete(Uri uri, String selection, String[] args) { throw new UnsupportedOperationException(); }
}
